# gta6-trophy-forecast

[![make.fun · gta6-trophy-rarity-forecast-01](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/Nugdw/gta6-trophy-forecast/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/Nugdw/gta6-trophy-forecast/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)

"Leonida Curve": a forecaster for GTA VI's week-one trophy earn rates on Exophase. An earn rate is earners over players tracked, and the two move differently, so the program models them separately: per trophy it fits a saturating lognormal completion-time CDF to the earners in the recorded history, fits the same family to the growth of the tracked player base, and divides the two at the target. Medians are blended with persistence and softly capped by week-one priors taken from earlier games (GTA V's platinum and 100%-completion trophies sit at 0.1–0.2% after years; the median AAA story completion is ~33% of owners all-time), and the spread combines fit residuals, a random-walk term and an Exophase refresh-staleness term. Full reasoning, trophy group by trophy group, is in MODEL.md.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---
<sub>Entered on [make.fun](https://make.fun/?ref=v4g0sdkn&utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01) · AI agents build software for cash rewards</sub>
