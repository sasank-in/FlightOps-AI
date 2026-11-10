# Data Dictionary

Source: `DASHlink_full_data_documentation.pdf` (official). Observed ranges are computed
over all 99,837 × 160 samples on 2026-11-10. Distinct values are counted on a 1/97 subsample.

Telemetry array `data`: shape (99837, 160, 20) = (window, second, variable).

| Idx | Official name | Description (official) | Unit (official) | Min | Median | Max | Distinct | Notes |
|----:|---------------|------------------------|-----------------|----:|-------:|----:|---------:|-------|
| 0 | AILERON POSITION LH | Left aileron position | Degree | 41.90 | 84.53 | 124.53 | 2,757 | Not centred on 0; possible offset/encoding |
| 1 | AILERON POSITION RH | Right aileron position | Degree | 41.90 | 82.63 | 124.33 | 2,008 | Same as idx 0 |
| 2 | CORRECTED ANGLE OF ATTACK | Angle of attack | Degree | −18.14 | −4.87 | 13.43 | 164,088 | |
| 3 | BARO CORRECT ALTITUDE LSP | Altitude | Feet | −170.1 | 1,523.7 | 14,039.2 | 163,934 | Wide range for a near-touchdown window |
| 4 | COMPUTED AIRSPEED LSP | Airspeed | Knots | 63.6 | 124.5 | 264.2 | 160,652 | |
| 5 | SELECTED COURSE | Selected course for autopilot | Degree | −180.0 | −6.06 | 178.9 | 409 | Circular (±180); setting, few values |
| 6 | DRIFT ANGLE | Angle between heading and track | Degree | −26.63 | −0.52 | 25.97 | 164,503 | |
| 7 | ELEVATOR POSITION LEFT | Left elevator position | Degree | −41.90 | −4.26 | 40.71 | 2,711 | |
| 8 | T.E. FLAP POSITION | Flap deployment | Discrete | 0 | 3,654 | 3,766 | 2,201 | Encoding unknown; documented discrete but many values |
| 9 | GLIDESLOPE DEVIATION | Deviation from glide slope (DDM) | Percentage | −0.80 | 0.00 | 0.80 | 9,289 | Range looks like DDM, not % |
| 10 | SELECTED HEADING | Heading selected for autopilot | Degree | −180.0 | −7.12 | 178.9 | 801 | Circular (±180); setting |
| 11 | LOCALIZER DEVIATION | Deviation from runway axis (DDM) | Percentage | −0.40 | 0.00 | 0.40 | 7,334 | Range looks like DDM, not % |
| 12 | CORE SPEED AVG | Avg low-pressure compressor speed, 4 engines (throttle indicator) | Percentage | 27.92 | 78.39 | 96.99 | 155,946 | |
| 13 | TOTAL PRESSURE LSP | Total pressure | Millibar | −9.27 | 989.37 | 1,088.55 | 153,991 | Negative minimum is physically impossible |
| 14 | PITCH ANGLE LSP | Pitch angle | Degree | −16.40 | −2.37 | 11.40 | 164,219 | |
| 15 | ROLL ANGLE LSP | Roll angle | Degree | −43.16 | 0.03 | 50.15 | 164,556 | |
| 16 | RUDDER POSITION | Rudder position | Degree | −64.07 | −0.16 | 72.40 | 164,458 | |
| 17 | TRUE HEADING LSP | True heading | Degree | −290.3 | −33.74 | 289.6 | 164,014 | Exceeds ±180; check wrap before circular encoding |
| 18 | VERTICAL ACCELERATION | Vertical acceleration | G | −4.03 | 0.99 | 1.85 | 160,016 | Large negative spikes |
| 19 | WIND SPEED | Wind speed | Knots | −0.97 | 11.10 | 63.26 | 164,114 | Small negative values |

## Labels (`label`, float64)

| Value | Class |
|------:|-------|
| 0 | Nominal |
| 1 | Speed High |
| 2 | Path High |
| 3 | Flaps Late Setting |

## Metadata (`DASHlink_full_fourclass_raw_meta.csv`)

| Column | Notes |
|--------|-------|
| `data_instance` | Row index into the arrays (0…99836), unique |
| `flight_record` | Unique per row; structured numeric ID whose meaning is undocumented |
| `departure_airport`, `arrival_airport` | ICAO codes (205 departure, 97 arrival) |
| `departure_runway`, `arrival_runway` | Runway identifiers |
| `label` | Same values as the array labels |
