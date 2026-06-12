import os
import json
import time
from flask import Flask, render_template, jsonify
from dotenv import load_dotenv
from scraper import get_events_list, get_event_details, fetch_all_stats
from analyzer import analyze_fights, compute_model_record

load_dotenv()

app = Flask(__name__)
ODDS_API_KEY = os.environ.get('ODDS_API_KEY', '')

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
os.makedirs(DATA_DIR, exist_ok=True)

CACHE_TTL = 3600  # 1 hour

_mem = {}


def _disk_read(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def _disk_write(path, data):
    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f)
    except Exception as e:
        print(f'Disk write error {path}: {e}')


def _index_path():
    return os.path.join(DATA_DIR, 'events_index.json')


def _event_path(event_id):
    return os.path.join(DATA_DIR, f'event_{event_id}.json')


def get_events_index(force=False):
    now = time.time()
    cache = _mem.get('index', {})
    if not force and cache.get('data') and now - cache.get('ts', 0) < CACHE_TTL:
        return cache['data']

    path = _index_path()
    if not force and os.path.exists(path) and now - os.path.getmtime(path) < CACHE_TTL:
        data = _disk_read(path)
        if data:
            _mem['index'] = {'data': data, 'ts': now}
            return data

    data = get_events_list()
    _disk_write(path, data)
    _mem['index'] = {'data': data, 'ts': now}
    return data


def _build_event_full(meta, force=False):
    now = time.time()
    event_id = meta['id']
    is_completed = meta.get('status') == 'completed'
    path = _event_path(event_id)

    # Completed events don't change — cache forever unless forced
    if not force and os.path.exists(path):
        mtime = os.path.getmtime(path)
        if is_completed or now - mtime < CACHE_TTL:
            data = _disk_read(path)
            if data:
                return data

    previous = _disk_read(path) if os.path.exists(path) else None
    previous_fights = previous.get('fights') if previous else None

    event = get_event_details(meta)
    if not event:
        return None
    event['fights'] = fetch_all_stats(event['fights'])
    event['fights'] = analyze_fights(event['fights'], ODDS_API_KEY, previous_fights)
    if is_completed:
        event['model_record'] = compute_model_record(event['fights'])

    _disk_write(path, event)
    return event


@app.route('/')
def index():
    return render_template('index.html', has_key=bool(ODDS_API_KEY))


@app.route('/api/events')
def api_events():
    try:
        return jsonify(get_events_index())
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/event/<event_id>')
def api_event_by_id(event_id):
    try:
        events = get_events_index()
        meta = next((e for e in events if e['id'] == event_id), None)
        if not meta:
            return jsonify({'error': 'Event not found'}), 404
        data = _build_event_full(meta)
        if not data:
            return jsonify({'error': 'Could not load event data'}), 404
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/event')
def api_event():
    try:
        events = get_events_index()
        meta = next((e for e in events if e.get('is_next')), None)
        if not meta:
            return jsonify({'error': 'No upcoming UFC event found'}), 404
        data = _build_event_full(meta)
        if not data:
            return jsonify({'error': 'Could not load event data'}), 404
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/event/<event_id>/refresh')
def api_event_refresh(event_id):
    try:
        events = get_events_index(force=True)
        meta = next((e for e in events if e['id'] == event_id), None)
        if not meta:
            return jsonify({'error': 'Event not found'}), 404
        data = _build_event_full(meta, force=True)
        if not data:
            return jsonify({'error': 'Could not load event data'}), 404
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)
