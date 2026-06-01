import os
import time
from flask import Flask, render_template, jsonify
from dotenv import load_dotenv
from scraper import get_upcoming_event, fetch_all_stats
from analyzer import analyze_fights

load_dotenv()

app = Flask(__name__)
ODDS_API_KEY = os.environ.get('ODDS_API_KEY', '')

_cache = {}
CACHE_TTL = 3600  # 1 hour


def _build_event():
    event = get_upcoming_event()
    if not event:
        return None
    event['fights'] = fetch_all_stats(event['fights'])
    event['fights'] = analyze_fights(event['fights'], ODDS_API_KEY)
    return event


def get_cached_event(force=False):
    now = time.time()
    if not force and 'data' in _cache and now - _cache.get('ts', 0) < CACHE_TTL:
        return _cache['data']
    data = _build_event()
    _cache['data'] = data
    _cache['ts'] = now
    return data


@app.route('/')
def index():
    return render_template('index.html', has_key=bool(ODDS_API_KEY))


@app.route('/api/event')
def api_event():
    try:
        data = get_cached_event()
        if not data:
            return jsonify({'error': 'No upcoming UFC event found on ufcstats.com'}), 404
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/refresh')
def api_refresh():
    try:
        data = get_cached_event(force=True)
        if not data:
            return jsonify({'error': 'No upcoming UFC event found'}), 404
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)
