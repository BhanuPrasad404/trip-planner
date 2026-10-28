# Place understanding and opening hours: Phase 0 baseline

## What was measured, and what was not

- **Measured on the real code, offline:** TrailMate's own "read what the traveller wrote" path (`readInstant`), run on 168 labelled queries across 26 states.
- **Place data used:** The India place index that ships with the repo (about 70,000 places, GeoNames). The OpenStreetMap search (Photon) was NOT reachable in this run (stubbed to return nothing). So results for attractions are a LOWER BOUND for the full app, which can also ask the OpenStreetMap search.
- **Opening hours, measured offline:** what the current code does with 32 hand-written OpenStreetMap shapes, and how its name matching treats 22 hand-labelled name pairs. These are SHAPES and PAIRS, not real coverage.
- **NOT measured here:** real OpenStreetMap hours coverage for Indian places, correctness of any hours (0 trusted entries exist), cache hit rate, and real-network latency. Overpass (OpenStreetMap tags) was not queried.

## Place understanding (current system)

| Measure | Result |
|---|---|
| Labelled place found | 73.1% (114/156) |
| Right name, WRONG state (a different place with the same name) | 4.5% (7/156) |
| Right kind of place (city vs attraction), of those found | 94.7% (108/114) |
| Right kind of place, of all | 69.2% (108/156) |
| Ambiguous name: asked instead of guessing | 50% (6/12) |
| Ambiguous name: silently picked one | 33.3% (4/12) |
| Clear query: asked "check this" anyway | 17.3% (27/156) |
| Category request: kind of place understood (coarse interests only) | 83.3% (10/12) |
| Hours or discovery question: the QUESTION understood | 0% (0/18) |
| Discovery or category request: attractions suggested | 0% (0/20) |

### By kind of query

| Group | Queries | Found | Right kind | Asked when ambiguous | Silent guess | Asked needlessly |
|---|---|---|---|---|---|---|
| alt_spelling | 18 | 83.3% (15/18) | 100% (15/15) | n/a | n/a | 22.2% (4/18) |
| ambiguous | 12 | n/a | n/a | 50% (6/12) | 33.3% (4/12) | n/a |
| attraction | 36 | 47.2% (17/36) | 64.7% (11/17) | n/a | n/a | 11.1% (4/36) |
| category | 12 | 91.7% (11/12) | 100% (11/11) | n/a | n/a | 25% (3/12) |
| city | 36 | 100% (36/36) | 100% (36/36) | n/a | n/a | 22.2% (8/36) |
| compound | 12 | 0% (0/12) | n/a | n/a | n/a | 0% (0/12) |
| discovery | 8 | 100% (8/8) | 100% (8/8) | n/a | n/a | 37.5% (3/8) |
| hours_question | 10 | 40% (4/10) | 100% (4/4) | n/a | n/a | 0% (0/10) |
| native_script | 6 | 100% (6/6) | 100% (6/6) | n/a | n/a | 0% (0/6) |
| region | 18 | 94.4% (17/18) | 100% (17/17) | n/a | n/a | 27.8% (5/18) |

### By state (labelled place found)

| State | Found |
|---|---|
| Andhra Pradesh | 9/12 |
| Assam | 1/2 |
| Bihar | 1/1 |
| Chhattisgarh | 1/1 |
| Delhi | 3/6 |
| Goa | 3/3 |
| Gujarat | 2/5 |
| Haryana | 0/1 |
| Himachal Pradesh | 1/2 |
| Jammu and Kashmir | 2/2 |
| Jharkhand | 1/1 |
| Karnataka | 11/13 |
| Kerala | 11/13 |
| Madhya Pradesh | 3/4 |
| Maharashtra | 7/12 |
| Meghalaya | 1/1 |
| Odisha | 4/5 |
| Puducherry | 2/2 |
| Punjab | 2/3 |
| Rajasthan | 9/13 |
| Sikkim | 1/1 |
| Tamil Nadu | 14/17 |
| Telangana | 9/12 |
| Uttar Pradesh | 10/14 |
| Uttarakhand | 3/3 |
| West Bengal | 3/7 |

### Every query that did not do the right thing (91)

| id | group | query | what came back |
|---|---|---|---|
| q016 | city | Ahmedabad | Ahmedabad→Ahmedabad (city, Gujarat) [asked to check] |
| q018 | city | Jaipur | Jaipur→Jaipur (city, Rajasthan) [asked to check] |
| q019 | city | Udaipur | Udaipur→Udaipur (city, Rajasthan) [asked to check] |
| q020 | city | Jodhpur | Jodhpur→Jodhpur (city, Rajasthan) [asked to check] |
| q022 | city | Agra | Agra→Agra (city, Uttar Pradesh) [asked to check] |
| q028 | city | Patna | Patna→Patna (city, Bihar) [asked to check] |
| q032 | city | Srinagar | Srinagar→Srinagar (city, Jammu and Kashmir) [asked to check] |
| q035 | city | Raipur | Raipur→Raipur (city, Chhattisgarh) [asked to check] |
| q037 | region | Goa | Goa→Goa (state, Goa) [asked to check] |
| q038 | region | Coorg | Coorg→Kodagu (district, Karnataka) [asked to check] |
| q043 | region | Manali | Manali→Manali (town, Tamil Nadu) [asked to check] (right name, WRONG state) |
| q051 | region | Mount Abu | Mount Abu→Abu (town, Rajasthan) [asked to check] |
| q053 | region | Alleppey | Alleppey→Alappuzha (district, Kerala) [asked to check] |
| q058 | attraction | Gol Gumbaz | Gol Gumbaz→not found |
| q060 | attraction | Brihadeeswarar Temple | Brihadeeswarar Temple→not found |
| q061 | attraction | Padmanabhaswamy Temple | Padmanabhaswamy Temple→not found |
| q062 | attraction | Taj Mahal | Taj Mahal→not found |
| q063 | attraction | Agra Fort | Agra Fort→Agra (city, Uttar Pradesh) [asked to check] (found, but as the wrong kind of place) |
| q064 | attraction | Fatehpur Sikri | Fatehpur Sikri→Fatehpur Sikri (town, Uttar Pradesh) (found, but as the wrong kind of place) |
| q065 | attraction | Qutub Minar | Qutub Minar→not found |
| q067 | attraction | Humayun's Tomb | Humayun's Tomb→not found |
| q069 | attraction | Gateway of India | Gateway India→not found |
| q070 | attraction | Ajanta Caves | Ajanta Caves→not found |
| q071 | attraction | Ellora Caves | Ellora Caves→Ellora (town, Maharashtra) (found, but as the wrong kind of place) |
| q073 | attraction | Amer Fort | Amer Fort→Amer (locality, Bihar) (right name, WRONG state) |
| q075 | attraction | Lingaraj Temple | Lingaraj Temple→Lingaraj (subdistrict, Odisha) (found, but as the wrong kind of place) |
| q077 | attraction | Sanchi Stupa | Sanchi Stupa→not found |
| q078 | attraction | Khajuraho Temples | Khajuraho Temples→Khajuraho Group of Monuments (town, Madhya Pradesh) [asked to check] (found, but as the wrong kind of place) |
| q079 | attraction | Victoria Memorial | Victoria Memorial→not found |
| q080 | attraction | Howrah Bridge | Howrah Bridge→not found |
| q082 | attraction | Kaziranga National Park | Kaziranga National Park→not found |
| q083 | attraction | Tirumala Venkateswara Temple | Tirumala Venkateswara Temple→not found |
| q084 | attraction | Kailasagiri | Kailasagiri→Kailasagiri (town, Tamil Nadu) (right name, WRONG state) |
| q085 | attraction | Ramoji Film City | Ramoji Film City→not found |
| q087 | attraction | Statue of Unity | Statue Unity→not found |
| q088 | attraction | Somnath Temple | Somnath Temple→Somnath Temple (sight, Chhattisgarh) [asked to check] (right name, WRONG state) |
| q089 | attraction | Kedarnath Temple | Kedarnath Temple→Kedarnath (town, Uttarakhand) [asked to check] (found, but as the wrong kind of place) |
| q090 | attraction | Kashi Vishwanath Temple | Kashi Vishwanath Temple→not found |
| q091 | compound | Hawa Mahal Jaipur | Hawa Mahal Jaipur→not found |
| q092 | compound | Charminar Hyderabad | Charminar Hyderabad→not found |
| q093 | compound | Meenakshi Temple Madurai | Meenakshi Temple Madurai→not found |
| q094 | compound | Kashi Vishwanath temple Varanasi | Kashi Vishwanath temple Varanasi→not found |
| q095 | compound | Golden Temple Amritsar | Golden Temple Amritsar→not found |
| q096 | compound | Mysore Palace Mysuru | Mysore Palace Mysuru→not found |
| q097 | compound | Gateway of India Mumbai | Gateway India Mumbai→not found |
| q098 | compound | Victoria Memorial Kolkata | Victoria Memorial Kolkata→not found |
| q099 | compound | Lingaraj Temple Bhubaneswar | Lingaraj Temple Bhubaneswar→not found |
| q100 | compound | Padmanabhaswamy Temple Thiruvananthapuram | Padmanabhaswamy Temple Thiruvananthapuram→not found |
| q101 | compound | Kailasagiri Visakhapatnam | Kailasagiri Visakhapatnam→not found |
| q102 | compound | Ramoji Film City Hyderabad | Ramoji Film City Hyderabad→not found |
| q108 | ambiguous | City Palace | City Palace→not found |
| q109 | ambiguous | Venkateswara Temple | Venkateswara Temple→not found |
| q110 | ambiguous | Sun Temple | Sun Temple→Sun City (locality, Tamil Nadu) (should have asked) |
| q111 | ambiguous | Bijapur | Bijapur→Bijapur (town, Chhattisgarh) (should have asked) |
| q112 | ambiguous | Raigarh | Raigarh→Raigarh (city, Chhattisgarh) (should have asked) |
| q114 | ambiguous | Jagannath Temple | Jagannath Temple→Puri (city, Odisha) (should have asked) |
| q123 | alt_spelling | Baroda | Baroda→Baroda (town, Madhya Pradesh) [asked to check] (right name, WRONG state) |
| q126 | alt_spelling | Gurgaon | Gurgaon→Gurgaon (locality, Maharashtra) [asked to check] (right name, WRONG state) |
| q128 | alt_spelling | Madras | Madras→Chennai (city, Tamil Nadu) [asked to check] |
| q129 | alt_spelling | Bombay | Bombay→not found |
| q132 | alt_spelling | Mamallapuram | Mamallapuram→Mahabalipuram (town, Tamil Nadu) [asked to check] |
| q139 | category | beaches near Visakhapatnam | Visakhapatnam→Visakhapatnam (city, Andhra Pradesh) |
| q140 | category | temples in Tirupati | Tirupati→Tirupati (city, Andhra Pradesh) |
| q141 | category | waterfalls near Hyderabad | Hyderabad→Hyderabad (city, Telangana) |
| q142 | category | forts in Jaipur | Jaipur→Jaipur (city, Rajasthan) [asked to check] |
| q143 | category | museums in Delhi | Delhi→Delhi (city, Delhi) |
| q144 | category | temples near Madurai | Madurai→Madurai (city, Tamil Nadu) |
| q145 | category | beaches in Goa | Goa→Goa (state, Goa) [asked to check] |
| q146 | category | forts in Rajasthan | Rajasthan→not found |
| q147 | category | wildlife near Mysuru | Mysuru→Mysuru (city, Karnataka) |
| q148 | category | lakes in Udaipur | Udaipur→Udaipur (city, Rajasthan) [asked to check] |
| q149 | category | temples in Kanchipuram | Kanchipuram→Kanchipuram (city, Tamil Nadu) |
| q150 | category | beaches near Kochi | Kochi→Kochi (city, Kerala) |
| q151 | hours_question | is Charminar open now | Charminar→Charminar (sight, Telangana) |
| q152 | hours_question | Golconda Fort timings | Golconda Fort→Golconda Fort (sight, Telangana) |
| q153 | hours_question | Taj Mahal opening hours on Friday | Taj Mahal opening hours Friday→not found |
| q154 | hours_question | what time does Meenakshi Temple open | Meenakshi Temple→not found |
| q155 | hours_question | Gateway of India timings | Gateway India→not found |
| q156 | hours_question | Amer Fort closing time | Amer Fort→Amer (locality, Bihar) (right name, WRONG state) |
| q157 | hours_question | Mysore Palace visiting hours | Mysore Palace→Mysore Palace (sight, Karnataka) |
| q158 | hours_question | Qutub Minar timings | Qutub Minar→not found |
| q159 | hours_question | Konark Sun Temple opening time | Konark Sun Temple→Konark Sun Temple (sight, Odisha) |
| q160 | hours_question | Victoria Memorial timings | Victoria Memorial→not found |
| q161 | discovery | things to do in Tirupati | Tirupati→Tirupati (city, Andhra Pradesh) |
| q162 | discovery | what to see in Udaipur | Udaipur→Udaipur (city, Rajasthan) [asked to check] |
| q163 | discovery | places to visit in Hyderabad | Hyderabad→Hyderabad (city, Telangana) |
| q164 | discovery | best places in Goa | Goa→Goa (state, Goa) [asked to check] |
| q165 | discovery | top attractions in Mysuru | Mysuru→Mysuru (city, Karnataka) |
| q166 | discovery | sightseeing in Agra | Agra→Agra (city, Uttar Pradesh) [asked to check] |
| q167 | discovery | what to do in Pondicherry | Pondicherry→Puducherry (city, Puducherry) |
| q168 | discovery | places to see in Kochi | Kochi→Kochi (city, Kerala) |

## Opening hours (current system, offline)

### Which OpenStreetMap shapes become a place we can look hours up for

Kept as a place: 45.2% (14/31) of 31 named shapes.

| Kind of place | Kept |
|---|---|
| attraction | 100% (2/2) |
| beach | 0% (0/1) |
| cave | 0% (0/1) |
| church | 0% (0/1) |
| fort | 100% (2/2) |
| gurdwara | 0% (0/1) |
| lake | 0% (0/1) |
| monument | 66.7% (2/3) |
| mosque | 0% (0/1) |
| museum | 100% (1/1) |
| palace | 50% (1/2) |
| park | 0% (0/3) |
| peak | 0% (0/1) |
| temple | 37.5% (3/8) |
| viewpoint | 100% (1/1) |
| waterfall | 100% (1/1) |
| zoo | 100% (1/1) |

Hours-related tags that survive when a shape is stored:

| Tag | Kept |
|---|---|
| `opening_hours` | 66.7% (4/6) |
| `opening_hours:url` | 0% (0/1) |
| `service_times` | 0% (0/1) |
| `website` | 0% (0/1) |

### Name matching between a trip stop and a map object

Same place recognised: 33.3% (5/15). Different places kept apart: 42.9% (3/7).

| Stop | Map name | Similarity | Should match | Matches now |
|---|---|---|---|---|
| Charminar | Charminar | 1 | yes | yes |
| Golconda Fort | Golkonda Fort | 0 | yes | no |
| Mysore Palace | Mysuru Palace | 0.33 | yes | no |
| Amer Fort | Amber Fort | 0 | yes | no |
| Hawa Mahal | Hawa Mahal (Palace of Winds) | 0.85 | yes | yes |
| Meenakshi Temple | Meenakshi Amman Temple | 0.5 | yes | no |
| Sri Venkateswara Temple Tirumala | Tirumala Sri Venkateswara Swamy Temple | 0.75 | yes | yes |
| Victoria Memorial | Victoria Memorial Hall | 0.85 | yes | yes |
| Jama Masjid | Jama Masjid Delhi | 0.85 | yes | yes |
| Brihadeeswarar Temple | Brihadisvara Temple | 0 | yes | no |
| Golden Temple | Harmandir Sahib | 0 | yes | no |
| Mysore Palace | Amba Vilas Palace | 0.25 | yes | no |
| Lotus Temple | Bahá'í House of Worship | 0 | yes | no |
| Charminar | చార్మినార్ | 0 | yes | no |
| Taj Mahal | తాజ్ మహల్ | 0 | yes | no |
| Taj Mahal | Taj Mahal Palace Hotel | 0.85 | no | yes |
| Red Fort | Red Fort Metro Station | 0.85 | no | yes |
| Marina Beach | Marina Beach Road | 0.85 | no | yes |
| Gateway of India | Gateway of India Restaurant | 0.85 | no | yes |
| Konark Sun Temple | Konark Beach | 0 | no | no |
| Golconda Fort | Golconda Dam | 0 | no | no |
| Padmanabhaswamy Temple | Padmanabha Swamy Temple Road | 0 | no | no |

### Correctness of hours

**Not measurable yet:** `tests/fixtures/place-intel/hours-truth.json` has no trusted entries. Nothing is guessed to fill it.

## Speed (this machine, offline; varies from run to run)

p50 41.61 ms, p95 58.99 ms, max 612.35 ms per query.

