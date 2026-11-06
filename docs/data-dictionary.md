# Data Dictionary

> Status: **NOT YET VERIFIED.** Index, name, unit, and type must come from the
> official documentation. Leave a cell blank rather than guessing.

Type values: `continuous`, `circular` (wraps at 360°), `discrete/categorical`, `bounded`.

| Index | Candidate name | Official name | Unit | Type | Validity notes |
|-------|----------------|---------------|------|------|----------------|
| | Left aileron position | | | | |
| | Right aileron position | | | | |
| | Corrected angle of attack | | | | |
| | Barometric corrected altitude | | | continuous | Check physical plausibility |
| | Computed airspeed | | | continuous | Check physical plausibility |
| | Selected course | | | circular? | Handle wraparound |
| | Drift angle | | | | |
| | Left elevator position | | | | |
| | Trailing-edge flap position | | | discrete? | Do not treat as continuous without justification |
| | Glideslope deviation | | | | |
| | Selected heading | | | circular? | Handle wraparound |
| | Localizer deviation | | | | |
| | Core speed average | | | | |
| | Total pressure | | | | |
| | Pitch angle | | | | |
| | Roll angle | | | | |
| | Rudder position | | | | |
| | True heading | | | circular? | Handle wraparound |
| | Vertical acceleration | | | | |
| | Wind speed | | | | |
