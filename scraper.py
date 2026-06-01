import re
import hashlib
import time
import requests
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor

BASE = 'http://www.ufcstats.com'

_session = requests.Session()
_session.headers['User-Agent'] = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
)


def _solve_pow(html):
    nonce_m = re.search(r'nonce="([^"]+)"', html)
    diff_m = re.search(r'new Array\((\d+)\+1\)', html)
    if not nonce_m or not diff_m:
        return
    nonce = nonce_m.group(1)
    target = '0' * int(diff_m.group(1))
    n = 0
    while True:
        if hashlib.sha256(f'{nonce}:{n}'.encode()).hexdigest().startswith(target):
            break
        n += 1
    _session.post(
        f'{BASE}/__c',
        data={'nonce': nonce, 'n': str(n)},
        headers={'Content-Type': 'application/x-www-form-urlencoded'},
        timeout=10,
    )


def _get(url):
    resp = _session.get(url, timeout=15)
    resp.raise_for_status()
    if 'Checking your browser' in resp.text:
        _solve_pow(resp.text)
        resp = _session.get(url, timeout=15)
    return BeautifulSoup(resp.text, 'html.parser')


def _event_id(url):
    return hashlib.md5(url.encode()).hexdigest()[:12]


def _scrape_event_list(page_url, status):
    soup = _get(page_url)
    table = soup.select_one('table.b-statistics__table-events')
    if not table:
        return []
    events = []
    for row in table.select('tbody tr.b-statistics__table-row'):
        link_el = row.select_one('a.b-link')
        if not link_el:
            continue
        cols = row.select('td')
        date_el = cols[0].select_one('span.b-statistics__date') if cols else None
        events.append({
            'id': _event_id(link_el['href']),
            'name': link_el.text.strip(),
            'url': link_el['href'],
            'date': date_el.text.strip() if date_el else '',
            'location': cols[1].text.strip() if len(cols) > 1 else '',
            'status': status,
            'is_next': False,
            'is_most_recent': False,
        })
    return events


def get_events_list(max_completed=8):
    upcoming = _scrape_event_list(f'{BASE}/statistics/events/upcoming', 'upcoming')
    completed = _scrape_event_list(f'{BASE}/statistics/events/completed', 'completed')
    if upcoming:
        upcoming[0]['is_next'] = True
    if completed:
        completed[0]['is_most_recent'] = True
    return upcoming + completed[:max_completed]


def get_event_details(meta):
    is_completed = meta.get('status') == 'completed'
    fights = _get_fights(meta['url'], completed=is_completed)
    return {**meta, 'fights': fights}


def _get_fights(event_url, completed=False):
    soup = _get(event_url)
    fights = []

    for row in soup.select('tr.b-fight-details__table-row'):
        if 'b-fight-details__table-row__hover' not in row.get('class', []):
            continue
        tds = row.select('td')
        if not tds:
            continue

        links = tds[1].select('a') if len(tds) > 1 else []
        if len(links) < 2:
            continue

        weight_class = tds[6].text.strip() if len(tds) > 6 else ''

        fights.append({
            'fighter1': {'name': links[0].text.strip(), 'link': links[0].get('href', '')},
            'fighter2': {'name': links[1].text.strip(), 'link': links[1].get('href', '')},
            'weight_class': weight_class,
            'winner': links[0].text.strip() if completed else None,
        })

    return fights


def get_fighter_stats(url):
    if not url:
        return {}
    try:
        time.sleep(0.3)
        soup = _get(url)
        stats = {}

        name_el = soup.select_one('span.b-content__title-highlight')
        if name_el:
            stats['name'] = name_el.text.strip()

        record_el = soup.select_one('span.b-content__title-record')
        if record_el:
            m = re.search(r'(\d+)-(\d+)-(\d+)', record_el.text)
            if m:
                stats['wins'] = int(m.group(1))
                stats['losses'] = int(m.group(2))
                stats['draws'] = int(m.group(3))
                stats['record'] = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"

        for item in soup.select('li.b-list__box-list-item'):
            title_el = item.select_one('i.b-list__box-item-title')
            if not title_el:
                continue
            key = title_el.get_text(strip=True).rstrip(':').lower()
            raw = item.get_text(strip=True).replace(title_el.get_text(strip=True), '', 1).strip()

            if 'slpm' in key:
                stats['slpm'] = _f(raw)
            elif 'str. acc' in key:
                stats['str_acc'] = _pct(raw)
            elif 'sapm' in key:
                stats['sapm'] = _f(raw)
            elif 'str. def' in key:
                stats['str_def'] = _pct(raw)
            elif 'td avg' in key:
                stats['td_avg'] = _f(raw)
            elif 'td acc' in key:
                stats['td_acc'] = _pct(raw)
            elif 'td def' in key:
                stats['td_def'] = _pct(raw)
            elif 'sub. avg' in key:
                stats['sub_avg'] = _f(raw)
            elif 'reach' in key:
                stats['reach'] = raw
            elif 'height' in key:
                stats['height'] = raw
            elif 'stance' in key:
                stats['stance'] = raw

        return stats
    except Exception as e:
        print(f'Fighter scrape error {url}: {e}')
        return {}


def fetch_all_stats(fights):
    links = []
    for f in fights:
        links.append(f['fighter1']['link'])
        links.append(f['fighter2']['link'])

    with ThreadPoolExecutor(max_workers=4) as ex:
        all_stats = list(ex.map(get_fighter_stats, links))

    for i, fight in enumerate(fights):
        fight['fighter1']['stats'] = all_stats[i * 2]
        fight['fighter2']['stats'] = all_stats[i * 2 + 1]

    return fights


def _f(v):
    try:
        return float(v) if v and v != '--' else 0.0
    except:
        return 0.0


def _pct(v):
    try:
        return float(v.rstrip('%')) / 100.0 if v and v != '--' else 0.0
    except:
        return 0.0
