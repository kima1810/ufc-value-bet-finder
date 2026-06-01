# UFC Value Bet Finder

A web app that scrapes UFC fight cards, analyzes fighter stats, and identifies value bets using a statistical model combined with live odds data.

## Quick Start

**1. Install dependencies**
```
pip install -r requirements.txt
```

**2. Add your Odds API key** *(optional — app works without it, model picks only)*

Copy `.env.example` to `.env` and paste your key from [the-odds-api.com](https://the-odds-api.com) (free tier: 500 requests/month):
```
ODDS_API_KEY=your_key_here
```

**3. Run**
```
python app.py
```

Open `http://localhost:5000` in your browser. The first load takes ~15 seconds while it scrapes fighter stats.

---

## Features

- **Live fight card scraping** — pulls the upcoming event and full fighter roster from UFCStats.com automatically
- **Statistical model** — scores each fighter on striking efficiency, defense, and grappling to estimate win probability
- **Value bet detection** — compares model probabilities to bookmaker implied odds; flags fights where the model finds an edge above 5%
- **Live odds integration** — fetches best available American odds across multiple bookmakers via The Odds API
- **Event history sidebar** — slide-in panel lists all upcoming and recent completed events; click any to load it
- **Odds memory** — analyzed event data is cached to disk so odds are preserved even after the event ends and the API stops listing them
- **Past event results** — completed events show the actual winner with a checkmark on each fight card, and losers are visually dimmed
- **Model accuracy record** — past events display a running tally of how many picks the model got correct vs incorrect
- **No-odds / no-card states** — clearly indicates when fights haven't been announced yet or when odds haven't posted
- **Fighter stats comparison** — expandable side-by-side stat bars for SLpM, strike accuracy, strike defense, takedown avg, and takedown defense
- **One-hour cache** — upcoming event data refreshes automatically every hour; hit the Refresh button to force an update
