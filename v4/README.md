# Last Letter Finder V4

V4 is a separate app; the scraper and its source files remain at the project root.

1. Regenerate the trap and spam indexes after updating `../lll.txt` with `npm run build:v4-data`.
2. Start the local app with `npm run v4`.
3. Open `http://localhost:4174/v4/`.

Casual traps use letters only, require at least three solves, reject `+e`, `+s`, and `+es`, and require every solve to be at least two letters longer than the trap part. Pro traps allow symbols, use the same two-letter solve-length minimum, and are included when there are 1–5 solves. Normal results are sampled and sorted shortest-first. Spam results rotate through the selected ending groups before repeating a group. Each result column shows at most 50 words.
