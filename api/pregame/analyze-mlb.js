# PaiGrade — Session Handoff
**Date:** March 31, 2026
**Live URL:** https://consensus-picks-mvp.vercel.app
**Repo:** github.com/birthquake/consensus-picks-mvp
**Firebase project:** corkt-47808
**Stack:** React/Vite (Vercel), Node.js serverless functions, Firestore, Anthropic Claude Haiku, ESPN public APIs

---

## IMPORTANT: DO NOT USE HAIKU FOR CODE CHANGES
Haiku introduced two bugs this session that required debugging and reverting:
1. Changed formatDate in scan.js to use UTC methods (getUTCFullYear etc) — caused wrong date to be sent to ESPN, showing tomorrow's games instead of today's
2. Added a hardcoded NBA_SEASON_OUT_BLACKLIST to analyze.js — reasonable idea but needs manual maintenance

Use Sonnet for all code work on this project.

---

## WHAT WAS ACCOMPLISHED THIS SESSION

### NHL Support — COMPLETE AND ROBUST
- api/pregame/analyze-nhl.js — full NHL analyzer, deployed and working
- api/pregame/scan.js — added nhl to SPORT_CONFIG
- src/pages/Halftime.jsx — full NHL UI integration (Pre-Game tab, Daily Card, GameCard routing)

### NHL analyzer features (full parity with NBA model):
- Back-to-back detection via ESPN schedule endpoint, 8% projection penalty
- Opponent defensive rating via ESPN team statistics endpoint (season totals / gamesPlayed)
- Variance (std dev) over last 10 games per stat
- Floor detection — worst game in last 10; near-free flag if floor >= line
- Trend detection — last 5 vs last 10, labeled up/down/neutral
- Data-driven star rating — computed from edge size, trend, std dev, floor, B2B, opponent multiplier, backup goalie flag
- Position-aware — D-men get reduced point/goal/assist projections
- Goalie backup uncertainty — starters with < 10 logged starts flagged as LIKELY-BACKUP
- Hard projection filter — picks where projection doesn't clear line dropped in code before UI
- legCount respected — passed from UI and used in prompt
- homeTeamId/awayTeamId passed from GameCard to skip findTeamId lookup

### Bug fixes this session:
**FG% calculation bug in halftime/analyze.js**
ESPN returns FG as "5-9" string. parseStatValue was splitting on dash and returning only made (5),
never setting fieldGoalsAttempted. Fixed by handling fieldGoalsMade separately in BOX_KEY_MAP loop.
Result: FG% in prompt was showing 5/10 (100%) instead of 5/9 (56%).

**Injured player filter in analyze.js**
Kyrie Irving (ACL, out all 2025-26 season) was appearing in picks. gamesPlayed < 3 only catches
full-season absences. Fixed by reading data.events[eventId].date from ESPN gamelog to get
lastGameDate, then skipping players whose last game was 14+ days ago.

**scan.js timezone bug (introduced and fixed this session)**
Haiku changed formatDate to use UTC methods (getUTCFullYear, getUTCMonth, getUTCDate).
Vercel servers run UTC — in ET evening, UTC is already the next day, so ESPN returned tomorrow's games.
Fix: use Eastern Time offset. date calculation now subtracts 4 hours (EDT) from UTC:
  const nowET    = new Date(Date.now() - 4 * 60 * 60 * 1000);
  const today    = formatDate(nowET);
  const tomorrow = formatDate(new Date(nowET.getTime() + 86400000));
NOTE: When clocks fall back to EST (November), change 4 to 5. This is in the backlog.

### Performance data (114 graded picks, first meaningful sample):
- 84% overall hit rate
- Rebounds: 97% (28/29) — model very conservative on rebound lines
- Shots NHL: 100% (7/7) — first night promising
- Points: 80% (33/41) — weakest core stat, FG% variance driver
- Star rating miscalibration: 3-star (88%) outperforming 4-star (85%) and 5-star (82%)
- Case sensitivity bug: "assists" and "Assists" appear as separate rows in Performance tab
- More graded picks expected after tonight's games

### Leg count slider simplified
- Changed to max 5 legs (min 2)
- CSS gradient divisor: (legCount - 2) / 3 * 100
- Label array: [2, 3, 4, 5]

---

## CURRENT FILE STATE

### Deployed API files (9/12 function slots):
```
api/cron/fetch-game-results.js
api/halftime/analyze.js        <- FG parsing bug fixed
api/halftime/save-picks.js
api/halftime/scan.js
api/halftime/stats.js
api/pregame/analyze-mlb.js
api/pregame/analyze.js         <- 14-day recency filter added, hardcoded blacklist added by Haiku
api/pregame/analyze-nhl.js     <- NEW, fully robust
api/pregame/scan.js            <- nhl added, ET timezone fix applied
```
3 function slots remaining.

### Deployed frontend:
- src/pages/Halftime.jsx — NBA/MLB/NHL tabs, persistent caches, leg slider min 2 max 5
- src/pages/Login.jsx — PaiGrade branded dark theme

---

## FULL BACKLOG

### High priority
- [ ] MLB model parity with NBA/NHL — add opponent defensive rating (pitcher ERA / team ERA),
      back-to-back/rest detection, variance + floor tracking, trend detection, data-driven star
      rating. Same pattern as NHL build. Priority: before MLB season gets deep.
- [ ] Star rating recalibration — after 200+ graded picks, revisit computeRating thresholds in
      analyze-nhl.js and rating framework in analyze.js. 3-star should not outperform 5-star.
- [ ] Feedback loop — inject last 30 days hit rate by stat type into Claude prompt before picks.
      Need ~100+ graded picks first (approaching now). projection_error field in Firestore shows
      direction of bias. avg_error (not avg_abs_error) is the key number — positive = under-projecting,
      negative = over-projecting.
- [ ] Performance tab case sensitivity bug — "assists" and "Assists" appear as separate rows.
      Fix in fetch-game-results.js: normalize stat names to lowercase before storing/grouping.

### Timezone / scheduling
- [ ] scan.js EST/EDT — currently hardcoded to EDT (UTC-4). Change offset to 5 when clocks fall
      back in November (EST = UTC-5). Consider making this dynamic using a proper timezone library.

### Data quality
- [ ] Injury status — ESPN roster always returns "Active"; 14-day recency filter is current
      workaround. analyze.js also has a hardcoded NBA_SEASON_OUT_BLACKLIST added by Haiku —
      this needs manual updates each season. Consider replacing with a paid injury API.
- [ ] MLB min games threshold — currently gamesPlayed < 1 for opening week.
      Change back to gamesPlayed < (p.isPitcher ? 2 : 3) after April 15, 2026.
- [ ] Remove MLB debug logs — console.log lines in getPlayerGamelog in analyze-mlb.js.
- [ ] Remove NBA status debug log — console.log('[pregame/analyze] ${p.name} raw status:...')
      in analyze.js.
- [ ] NHL home/away splits — gamelog events have no home/away field; needs extra schedule API
      call per event to map eventId to home/away. Deferred.
- [ ] NHL season ends mid-April 2026 — complete any NHL work before April 15.
- [ ] MLB ballpark factors — hardcoded lookup table by venue, apply to batter projections.
- [ ] MLB weather — OpenWeatherMap integration for outdoor stadiums.

### UI / UX
- [ ] Daily Card quick filters — removed due to black screen bug; re-add when pick volume higher.
      Root cause was likely Set serialization issue.
- [ ] UI disclaimer — "Always verify player availability before placing bets" on Daily Card
      and Pre-Game tabs.
- [ ] pick.game field missing on Daily Card picks — shows "proj 23.6 ." with nothing after dot.
- [ ] Wider launch prep — un-mute Submit Bet / History / Analytics tabs.
- [ ] Update tagline — currently says "NBA" only; should reflect NBA + MLB + NHL.

### Business / product
- [ ] Freemium model — free: Daily Card (no rationale), paid: Pre-Game + Live + Performance.
- [ ] Bankroll tracker — shelved pending UX rethink.
- [ ] Hit rate data — need ~200+ graded picks to make calibration decisions confidently.
      Currently at ~160 after tonight grades.

---

## KEY TECHNICAL DETAILS

### Models
- All pick generation: claude-haiku-4-5-20251001
- Model tagged on each pick for Performance tab tracking

### Firestore
- Collection: halftime_picks
- Fields: gameId, sport, league, gameName, gameDate, picks, projections, model,
          status, hit, actual_value, projection_error

### GitHub Actions cron
- File: .github/workflows/grade-bets.yml
- Runs every 2 hours
- Requires CRON_SECRET in both Vercel env vars and GitHub secrets
- Hits /api/cron/fetch-game-results

---

## ESPN DATA NOTES

### NBA
- Gamelog: https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{id}/gamelog
  - data.events is top-level map of eventId to { date, ... } — used for recency filter
  - allGames[0].eventId -> data.events[eventId].date = last game date
- Scoreboard: https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=YYYYMMDD
- Roster: https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{id}/roster
- Standings: https://site.api.espn.com/apis/site/v2/sports/basketball/nba/standings

### MLB
- Gamelog: https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes/{id}/gamelog
- Opening week threshold: gamesPlayed < 1 (change to normal after April 15)

### NHL (all confirmed this session)
- Gamelog: https://site.web.api.espn.com/apis/common/v3/sports/hockey/nhl/athletes/{id}/gamelog
  - Column names at data.names[] TOP LEVEL (not inside category — different from MLB/NBA)
  - Skater cols: goals, assists, points, shotsTotal, timeOnIcePerGame (+ others)
  - Goalie cols: gameStarted, saves, shotsAgainst, goalsAgainst, timeOnIcePerGame (+ others)
  - No hits or blockedShots available — shotsTotal used as shots prop proxy
- Team stats: https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/{id}/statistics
  - Returns season TOTALS — divide by gamesPlayed stat from same response
- Roster: https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/{id}/roster
- Schedule: https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/{id}/schedule?season={yyyy}
- Scoreboard: https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard

### NHL league averages used for multipliers
- shotsAgainstPerGame: 29.5
- goalsAgainstPerGame: 3.0
- savesPerGame: 26.5

---

## CODE PATTERNS

### analyze-nhl.js architecture
- findTeamId() — ESPN team lookup by abbreviation
- getTeamRoster() — returns players with isGoalie/isDefenseman flags
- getTeamDefenseStats() — fetches team statistics, divides totals by gamesPlayed
- getTeamSchedule() — fetches schedule, detects back-to-back (diffDays < 1.5)
- getPlayerGamelog() — fetches gamelog, parses from data.names (top level)
- buildSkaterProjection() — 60/40 blend, opponent multiplier capped +-20%, B2B penalty 8%,
                             variance, floor, trend, D-man adjustment
- buildGoalieProjection() — 55/45 blend, opponent pressure multiplier, B2B penalty, starts filter
- computeRating() — data-driven 1-5 stars from aligned factors
- generateNHLPicks() — Haiku prompt with full context, hard filter, normalization to PickCard shape

### analyze.js recency filter
In getPlayerGamelog, after allGames.reverse():
  let lastGameDate = null;
  if (data.events && allGames.length > 0) {
    const eventData = data.events[allGames[0].eventId];
    if (eventData?.date) lastGameDate = new Date(eventData.date);
  }
  return { ..., lastGameDate };

In handler playerData map, after gamesPlayed < 3 check:
  const lastGameDate = gamelogResults[i]?.lastGameDate;
  if (lastGameDate) {
    const daysSince = (new Date() - lastGameDate) / (1000 * 60 * 60 * 24);
    if (daysSince > 14) return null;
  }

### halftime/analyze.js FG fix
In getLiveBoxScore, inside BOX_KEY_MAP loop:
  if (statName === 'fieldGoalsMade') {
    const raw = String(athlete.stats[idx] ?? '');
    if (raw.includes('-') && !raw.startsWith('-')) {
      const parts = raw.split('-');
      playerStats.fieldGoalsMade      = parseInt(parts[0], 10) || 0;
      playerStats.fieldGoalsAttempted = parseInt(parts[1], 10) || 0;
    }
    continue;
  }

### scan.js timezone fix
  const nowET    = new Date(Date.now() - 4 * 60 * 60 * 1000); // EDT = UTC-4
  const today    = formatDate(nowET);
  const tomorrow = formatDate(new Date(nowET.getTime() + 86400000));
  // Change 4 to 5 in November when clocks fall back to EST

### formatDate (correct version — local time, not UTC)
  function formatDate(d) {
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
  }

### GameCard NHL routing
  endpoint = '/api/pregame/analyze-nhl'
  body = {
    gameId, league,
    homeTeam: game.homeTeam.abbreviation,
    awayTeam: game.awayTeam.abbreviation,
    homeTeamId: game.homeTeam.id,
    awayTeamId: game.awayTeam.id,
    gameDate, existingLegs, legCount
  }

### Halftime.jsx state architecture
  mode: 'daily' | 'pregame' | 'halftime' | 'performance'
  pregameSport: 'nba' | 'mlb' | 'nhl'
  dailySport: 'nba' | 'mlb' | 'nhl'

  Split scan state (each persists independently):
    nbaGames, nbaScanState, nbaLastScanned, nbaOddsMap
    mlbGames, mlbScanState, mlbLastScanned
    nhlGames, nhlScanState, nhlLastScanned
    liveGames, liveScanState, liveLastScanned

  Caches:
    dailyCache: { state, nbaPicks, mlbPicks, nhlPicks }
    pregameCache: { [gameId]: analysisData }

### Sportsbook minimums
  NBA/props: points 10.5, rebounds 3.5, assists 2.5, steals 0.5, blocks 0.5
  NHL: shots 2.5, points 0.5, goals 0.5, assists 0.5, saves 20.5

### Leg count slider — current state
  min=2, max=5, step=1
  Labels: [2, 3, 4, 5]
  CSS gradient divisor: (legCount - 2) / 3 * 100
