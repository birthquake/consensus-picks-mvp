# Firestore Database Schema

## Collections Structure

### users/{userId}/
User profile and authentication
```
users/{userId}
├── profile (document)
│   ├── email (string)
│   ├── displayName (string)
│   ├── createdAt (timestamp)
│   └── bankroll (number) - user's total betting bankroll
│
├── submitted_picks/ (collection)
│   └── {pickId} (document)
│       ├── SUBMISSION DATA:
│       │   ├── sport (string: "NFL", "NBA", "NHL", "CollegeBasketball")
│       │   ├── game (string: "KC Chiefs vs JAX Jaguars")
│       │   ├── wager (number: 2.50)
│       │   ├── originalOdds (string: "+900")
│       │   ├── submittedAt (timestamp)
│       │   │
│       │   └── legs (array of objects)
│       │       ├── [0]
│       │       │   ├── player (string: "Patrick Mahomes")
│       │       │   ├── stat (string: "Passing Yards")
│       │       │   ├── threshold (string: "230+")
│       │       │   ├── confidence (string: "High/Med/Low")
│       │       │   └── reasonSubmitted (string: "user's reason")
│       │       ├── [1] ... etc
│       │
│       ├── ANALYSIS DATA:
│       │   ├── recommendation (string: "BET", "REFINE", "SKIP")
│       │   ├── overallConfidence (number: 0-100)
│       │   ├── expectedHitRate (number: 0-1, e.g., 0.85)
│       │   ├── estimatedROI (number: -0.5 to +10)
│       │   │
│       │   ├── legAnalysis (array)
│       │   │   ├── [0]
│       │   │   │   ├── legNumber (number)
│       │   │   │   ├── player (string)
│       │   │   │   ├── recommendation (string: "KEEP", "REMOVE", "INVESTIGATE")
│       │   │   │   ├── last5Average (number)
│       │   │   │   ├── opponentRank (number)
│       │   │   │   ├── injuryStatus (string: "Healthy", "Questionable", "Out")
│       │   │   │   ├── snapCount (number: 0-100)
│       │   │   │   ├── strength (string: "STRONG", "MEDIUM", "WEAK")
│       │   │   │   └── score (number: 0-100)
│       │   │   ├── [1] ... etc
│       │   │
│       │   ├── removedLegs (array of objects)
│       │   │   └── [0]
│       │   │       ├── player (string)
│       │   │       ├── reason (string)
│       │   │       └── strength (number: 0-100)
│       │   │
│       │   ├── suggestedAdditions (array of objects)
│       │   │   └── [0]
│       │   │       ├── player (string)
│       │   │       ├── stat (string)
│       │   │       ├── threshold (string)
│       │   │       ├── reason (string)
│       │   │       └── strength (number: 0-100)
│       │   │
│       │   ├── refinedOdds (string: "+1500")
│       │   ├── refinedLegCount (number)
│       │   └── analysisTimestamp (timestamp)
│       │
│       ├── USER DECISION:
│       │   ├── userDecision (string: "FOLLOWED", "IGNORED", "PENDING")
│       │   ├── userModifiedLegs (array)
│       │   ├── finalWager (number)
│       │   └── decisionTimestamp (timestamp)
│       │
│       ├── RESULT DATA:
│       │   ├── status (string: "pending", "won", "lost")
│       │   ├── actualResult (array - which legs won/lost)
│       │   │   ├── [0]
│       │   │   │   ├── player (string)
│       │   │   │   ├── result (string: "WON", "LOST")
│       │   │   │   └── actualValue (number)
│       │   │   ├── [1] ... etc
│       │   │
│       │   ├── actualPayout (number)
│       │   ├── actualROI (number)
│       │   ├── settledAt (timestamp)
│       │   └── comparativeAnalysis
│       │       ├── userPickROI (number)
│       │       ├── refinedPickROI (number)
│       │       └── difference (number)
│
├── performance_stats/ (collection)
│   └── overall (document)
│       ├── AGGREGATE STATS:
│       │   ├── totalSubmitted (number)
│       │   ├── totalBet (number)
│       │   ├── totalWon (number)
│       │   ├── totalLost (number)
│       │   ├── currentWinRate (number: 0-1)
│       │   ├── totalWagered (number)
│       │   ├── totalWinnings (number)
│       │   ├── overallROI (number)
│       │   │
│       │   ├── SUBMITTED VS REFINED:
│       │   │   ├── submittedROI (number)
│       │   │   ├── refinedROI (number)
│       │   │   ├── improvementPercentage (number)
│       │   │   ├── timesFollowedAdvice (number)
│       │   │   └── adviceFollowRate (number: 0-1)
│       │   │
│       │   ├── BY SPORT:
│       │   │   ├── NFL
│       │   │   │   ├── record (string: "8-4")
│       │   │   │   ├── winRate (number)
│       │   │   │   ├── roi (number)
│       │   │   │   └── sampleSize (number)
│       │   │   ├── NBA {...}
│       │   │   ├── NHL {...}
│       │   │   └── CollegeBasketball {...}
│       │   │
│       │   ├── BY PLAYER:
│       │   │   └── playerStats (map)
│       │   │       ├── "Patrick Mahomes"
│       │   │       │   ├── record (string)
│       │   │       │   ├── hitRate (number)
│       │   │       │   ├── avgPerformance (number)
│       │   │       │   └── trend (string: "HOT", "COLD", "NEUTRAL")
│       │   │       ├── "Travis Kelce" {...}
│       │   │       └── ... more players
│       │   │
│       │   ├── TRENDS:
│       │   │   ├── weeklyData (array)
│       │   │   │   ├── [0]
│       │   │   │   │   ├── week (number)
│       │   │   │   │   ├── record (string)
│       │   │   │   │   ├── roi (number)
│       │   │   │   │   └── timestamp (timestamp)
│       │   │   │   └── ...
│       │   │   │
│       │   │   └── monthlyData (array)
│       │   │       └── similar structure
│       │   │
│       │   └── BAD HABITS DETECTED:
│       │       ├── habitId1
│       │       │   ├── habit (string: "Player Overexposure")
│       │       │   ├── severity (string: "HIGH", "MEDIUM", "LOW")
│       │       │   ├── impact (string: description)
│       │       │   └── suggestion (string)
│       │       └── ... more habits
│
└── alerts/ (collection)
    └── {alertId} (document)
        ├── type (string: "HABIT_DETECTED", "PATTERN_FOUND", "BANKROLL_WARNING")
        ├── severity (string: "HIGH", "MEDIUM", "LOW")
        ├── message (string)
        ├── data (object) - specific alert data
        ├── createdAt (timestamp)
        └── read (boolean)
```

## Key Design Decisions:

1. **Submitted picks are immutable** - Once stored, they show exactly what user submitted
2. **Analysis is separate** - We can re-analyze later or compare different analyses
3. **Flexibility for variants** - legAnalysis array allows comparing removed legs vs suggested additions
4. **Time-series data** - weekly/monthly data for trend analysis
5. **Player tracking** - Can see which specific players have high/low performance
6. **Bad habits** - Stored as array so we can track when habits form/disappear

## Indexing Requirements (Firestore):

Create composite indexes for:
```
Collection: users/{userId}/submitted_picks
- status + sport + submittedAt (for filtering by sport and time)
- userDecision + settledAt (for finding settled picks)

Collection: users/{userId}/performance_stats
- none needed (only one document per user)
```
