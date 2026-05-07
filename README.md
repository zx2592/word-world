# Word World

Pure HTML/CSS/JS vocabulary learning site inspired by Duolingo, Quizlet, Membean, and XP learning systems.

Live site: https://word-world-phi.vercel.app/

## Features

- Smart flashcards with pronunciation, phonetic spelling, definitions, example sentences, visual memory cues, synonyms, and antonyms
- Root and affix breakdown with animated word-part cards
- Membean-style root star map with connected word families and adaptive review reminders
- Practice loop with listening choice questions and dictation
- Quizlet-style mini games: matching, spelling puzzle, and timed challenge
- Daily XP goal, streak tracking, level progress, achievements, and skill tree
- Automatic wrong-word tracking with error analysis
- Responsive layout for mobile and desktop

## Run Locally

Open `index.html` in a browser, or serve the folder with any static file server.

```bash
python -m http.server 5173
```

Then visit `http://localhost:5173`.

## Validation

```bash
node tools/validate-app.mjs
```
