import requests
from difflib import SequenceMatcher


def get_odds(api_key):
    if not api_key:
        return []
    try:
        r = requests.get(
            'https://api.the-odds-api.com/v4/sports/mma_mixed_martial_arts/odds/',
            params={'apiKey': api_key, 'regions': 'us', 'markets': 'h2h', 'oddsFormat': 'american'},
            timeout=10
        )
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f'Odds API error: {e}')
        return []


def _sim(a, b):
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def _find_fight(f1, f2, odds_data):
    best, best_score, f1_is_home = None, 0.65, True
    for ev in odds_data:
        home, away = ev.get('home_team', ''), ev.get('away_team', '')
        fwd = (_sim(f1, home) + _sim(f2, away)) / 2
        rev = (_sim(f1, away) + _sim(f2, home)) / 2
        score = max(fwd, rev)
        if score > best_score:
            best_score, best, f1_is_home = score, ev, fwd >= rev
    return (best, f1_is_home) if best else (None, True)


def _implied(american):
    try:
        o = float(american)
        return abs(o) / (abs(o) + 100) if o < 0 else 100 / (o + 100)
    except:
        return None


def _best_odds(ev, name):
    best_decimal = None
    best_american = None
    for bm in ev.get('bookmakers', []):
        for mkt in bm.get('markets', []):
            if mkt['key'] != 'h2h':
                continue
            for outcome in mkt['outcomes']:
                if _sim(outcome['name'], name) > 0.75:
                    p = outcome['price']
                    dec = (p / 100 + 1) if p > 0 else (100 / abs(p) + 1)
                    if best_decimal is None or dec > best_decimal:
                        best_decimal, best_american = dec, p
    return best_american


def _avg_fair_prob(ev, name):
    probs = []
    for bm in ev.get('bookmakers', []):
        for mkt in bm.get('markets', []):
            if mkt['key'] != 'h2h':
                continue
            outcomes = mkt['outcomes']
            target = next((o for o in outcomes if _sim(o['name'], name) > 0.75), None)
            if not target:
                continue
            raw_probs = [_implied(o['price']) for o in outcomes]
            raw_probs = [p for p in raw_probs if p is not None]
            target_prob = _implied(target['price'])
            if target_prob and raw_probs:
                total = sum(raw_probs)
                probs.append(target_prob / total)
    return sum(probs) / len(probs) if probs else None


def _combat_score(s):
    if not s:
        return 1.0
    slpm = s.get('slpm', 0) or 0
    str_acc = s.get('str_acc', 0) or 0
    sapm = s.get('sapm', 0) or 0
    str_def = s.get('str_def', 0) or 0
    td_avg = s.get('td_avg', 0) or 0
    td_acc = s.get('td_acc', 0) or 0
    td_def = s.get('td_def', 0) or 0
    sub_avg = s.get('sub_avg', 0) or 0

    eff_strikes = slpm * max(str_acc, 0.1) * 2.5
    strike_def = str_def * 3.0 - sapm * 0.4
    grapple = td_avg * max(td_acc, 0.1) * 2.0 + sub_avg * 0.5 + td_def * 1.5

    return max(eff_strikes + strike_def + grapple, 0.1)


def _model_probs(s1, s2):
    c1, c2 = _combat_score(s1), _combat_score(s2)
    t = c1 + c2
    return c1 / t, c2 / t


def _find_previous_fight(f1_name, f2_name, previous_fights):
    if not previous_fights:
        return None
    for pf in previous_fights:
        pf1, pf2 = pf.get('fighter1', {}), pf.get('fighter2', {})
        if _sim(f1_name, pf1.get('name', '')) > 0.8 and _sim(f2_name, pf2.get('name', '')) > 0.8:
            return pf, False
        if _sim(f1_name, pf2.get('name', '')) > 0.8 and _sim(f2_name, pf1.get('name', '')) > 0.8:
            return pf, True
    return None


def _reasons(f1_name, f2_name, s1, s2, p1, implied1):
    reasons = []
    s1, s2 = s1 or {}, s2 or {}

    slpm1, slpm2 = s1.get('slpm', 0) or 0, s2.get('slpm', 0) or 0
    if slpm1 > 0 and slpm2 > 0 and slpm1 > slpm2 * 1.2:
        reasons.append(
            f"{f1_name} lands {slpm1:.2f} significant strikes per minute versus "
            f"{slpm2:.2f} for {f2_name}, a clear striking volume advantage."
        )

    str_def1 = s1.get('str_def', 0) or 0
    str_def2 = s2.get('str_def', 0) or 0
    sapm1 = s1.get('sapm', 0) or 0
    sapm2 = s2.get('sapm', 0) or 0

    if str_def1 > str_def2 + 0.08:
        reasons.append(
            f"Strike defense of {str_def1*100:.0f}% versus {str_def2*100:.0f}% makes "
            f"{f1_name} considerably harder to hit cleanly."
        )
    elif sapm1 > 0 and sapm2 > 0 and sapm1 < sapm2 * 0.82:
        reasons.append(
            f"{f1_name} absorbs only {sapm1:.2f} sig. strikes per minute compared to "
            f"{sapm2:.2f} for {f2_name}, indicating superior defensive output."
        )

    td1 = s1.get('td_avg', 0) or 0
    td2 = s2.get('td_avg', 0) or 0
    td_def2 = s2.get('td_def', 0) or 0

    if td1 > 0 and td1 > td2 * 1.5 and td_def2 < 0.72:
        reasons.append(
            f"Averaging {td1:.2f} takedowns per 15 min against {f2_name}'s "
            f"{td_def2*100:.0f}% takedown defense creates a dominant grappling path to victory."
        )

    if implied1 is not None:
        edge = p1 - implied1
        if edge > 0.04:
            reasons.append(
                f"Books price {f1_name} at {implied1*100:.0f}% implied probability; "
                f"the statistical model projects {p1*100:.0f}% — a {edge*100:.0f}% edge "
                f"indicating positive expected value at current lines."
            )
    else:
        reasons.append(
            f"Statistical model projects {p1*100:.0f}% win probability for {f1_name} "
            f"based on career striking efficiency, defense, and grappling metrics."
        )

    return reasons[:3]


def analyze_fights(fights, api_key='', previous_fights=None):
    odds_data = get_odds(api_key)
    results = []

    for fight in fights:
        f1, f2 = fight['fighter1'], fight['fighter2']
        s1, s2 = f1.get('stats', {}), f2.get('stats', {})

        p1, p2 = _model_probs(s1, s2)

        f1_odds = f2_odds = f1_implied = f2_implied = None
        ev, f1_is_home = _find_fight(f1['name'], f2['name'], odds_data)
        has_odds = ev is not None

        if ev:
            home_name = ev['home_team']
            away_name = ev['away_team']
            n1 = home_name if f1_is_home else away_name
            n2 = away_name if f1_is_home else home_name
            f1_odds = _best_odds(ev, n1)
            f2_odds = _best_odds(ev, n2)
            f1_implied = _avg_fair_prob(ev, n1)
            f2_implied = _avg_fair_prob(ev, n2)
        else:
            # Live odds API no longer has this fight (e.g. event finished) —
            # fall back to the odds captured the last time it was available.
            prev = _find_previous_fight(f1['name'], f2['name'], previous_fights)
            if prev:
                pf, swapped = prev
                pf1 = pf['fighter2'] if swapped else pf['fighter1']
                pf2 = pf['fighter1'] if swapped else pf['fighter2']
                f1_odds = pf1.get('odds')
                f2_odds = pf2.get('odds')
                prev_implied1 = pf1.get('implied_prob')
                prev_implied2 = pf2.get('implied_prob')
                f1_implied = prev_implied1 / 100 if prev_implied1 is not None else None
                f2_implied = prev_implied2 / 100 if prev_implied2 is not None else None
                has_odds = pf.get('has_odds', False)

        e1 = (p1 - f1_implied) if f1_implied else None
        e2 = (p2 - f2_implied) if f2_implied else None

        value_fighter = None
        value_reasons = []
        EDGE_THRESHOLD = 0.05

        if e1 is not None and e2 is not None:
            if e1 >= e2 and e1 > EDGE_THRESHOLD:
                value_fighter = f1['name']
                value_reasons = _reasons(f1['name'], f2['name'], s1, s2, p1, f1_implied)
            elif e2 > EDGE_THRESHOLD:
                value_fighter = f2['name']
                value_reasons = _reasons(f2['name'], f1['name'], s2, s1, p2, f2_implied)
        elif p1 > 0.57:
            value_fighter = f1['name']
            value_reasons = _reasons(f1['name'], f2['name'], s1, s2, p1, None)
        elif p2 > 0.57:
            value_fighter = f2['name']
            value_reasons = _reasons(f2['name'], f1['name'], s2, s1, p2, None)

        results.append({
            **fight,
            'fighter1': {
                **f1,
                'model_prob': round(p1 * 100, 1),
                'implied_prob': round(f1_implied * 100, 1) if f1_implied else None,
                'odds': f1_odds,
                'edge': round(e1 * 100, 1) if e1 is not None else None,
            },
            'fighter2': {
                **f2,
                'model_prob': round(p2 * 100, 1),
                'implied_prob': round(f2_implied * 100, 1) if f2_implied else None,
                'odds': f2_odds,
                'edge': round(e2 * 100, 1) if e2 is not None else None,
            },
            'value_fighter': value_fighter,
            'value_reasons': value_reasons,
            'has_odds': has_odds,
        })

    return results


def compute_model_record(fights):
    correct = incorrect = 0
    for fight in fights:
        winner = fight.get('winner')
        pick = fight.get('value_fighter')
        if winner and pick:
            if winner == pick:
                correct += 1
            else:
                incorrect += 1
    return {'correct': correct, 'incorrect': incorrect}
