// ---------- Shared safety helpers (COMM-368) ----------
// esc/cssSel/bag/clean*/uid are no longer defined anywhere in this repo's own
// files: they live in src/shared/safe-helpers.js, the one versioned module
// meant to be consumed byte-for-byte by every Box Log client (see that file's
// header and src/shared/README.md). These are the bare-identifier bindings the
// rest of the app has always used, re-pointed at that module — classic
// <script> tags share one global lexical environment, so a binding here is
// what app.js, src/format.js, src/sanitize.js and src/db.js all resolve to,
// exactly the way LIMITS below already works.
//
// `var`, not `const`, on purpose: a top-level `var` in a classic script also
// publishes onto the global object, which is precisely what the `function
// esc() {}` / `function bag() {}` declarations these replace did implicitly.
// The jsdom test harness reaches every app-level function that way
// (window.esc, window.bag, window.cleanISODate in test/sanitizers.test.mjs,
// alongside window.sanitizeEntry and friends), so keeping them on window is
// the no-behavior-change choice, not an accident. There is still exactly one
// implementation of each — these are bindings to it, not copies of it.
//
// safe-helpers.js is the FIRST script index.html loads, so window.BoxLogSafe
// is always populated by the time this line runs. cloud.js declares esc,
// cssSel and cleanStr itself, off window.BoxLogSafe directly, because it is
// evaluated before this file and its own code runs at that point. It used to
// be able to use `const` for them, being its own IIFE; it gave that wrapper
// up so src/community/*.js could share its scope, which put those three names
// in the same global lexical environment as these — so they are `var` there
// too, for the same reason the paragraph above gives for them being `var`
// here. `var` plus `var` is legal and binds the identical function twice;
// `const` plus `var` would be a redeclaration SyntaxError that killed
// whichever script loaded second.
const SAFE = window.BoxLogSafe;
var esc = SAFE.esc, cssSel = SAFE.cssSel, bag = SAFE.bag;
var cleanStr = SAFE.cleanStr, cleanMultilineStr = SAFE.cleanMultilineStr, cleanNum = SAFE.cleanNum, cleanId = SAFE.cleanId;
var cleanISODate = SAFE.cleanISODate, cleanTs = SAFE.cleanTs, uid = SAFE.uid;

// ---------- Data ----------
const CATEGORY_COLORS = {
  Squat: "var(--teal)", Deadlift: "var(--red)", Press: "var(--yellow)",
  Olympic: "var(--green)", Pull: "var(--purple)", Other: "var(--steel)",
  // Club: the box's own published catalogue (202609060028). Deliberately a
  // different colour from Custom's brass — on the picker the two sit next to
  // each other and the whole point of the club catalogue is that "everyone in
  // the box has this one" is not the same statement as "only I have this one".
  Custom: "var(--brass)", Club: "var(--blue)", Girls: "var(--purple)", Heroes: "var(--red)",
  Gymnastics: "var(--purple)", Weightlifting: "var(--blue)", Dumbbell: "var(--green)",
  Kettlebell: "var(--yellow)", "Odd Object": "var(--red)", Monostructural: "var(--steel)",
};

const CATEGORY_LABELS = {
  Squat: "Squat", Deadlift: "Deadlift", Press: "Press", Olympic: "Olympic",
  Pull: "Pull", Other: "Other", Custom: "Custom", Club: "Club", Girls: "Girls", Heroes: "Heroes",
  Gymnastics: "Gymnastics", Weightlifting: "Weightlifting", Dumbbell: "Dumbbell",
  Kettlebell: "Kettlebell", "Odd Object": "Odd Object", Monostructural: "Monostructural",
};

const MOVEMENTS = [
  { id: "back-squat", name: "Back Squat", category: "Squat" },
  { id: "front-squat", name: "Front Squat", category: "Squat" },
  { id: "overhead-squat", name: "Overhead Squat", category: "Squat" },
  { id: "box-squat", name: "Box Squat", category: "Squat" },
  { id: "pause-squat", name: "Pause Squat", category: "Squat" },
  { id: "zercher-squat", name: "Zercher Squat", category: "Squat" },
  { id: "bulgarian-split-squat", name: "Bulgarian Split Squat", category: "Squat" },
  { id: "squat-clusters", name: "Squat Clusters", category: "Squat" },
  { id: "safety-bar-squat", name: "Safety Bar Squat", category: "Squat" },
  { id: "pin-squat", name: "Pin Squat", category: "Squat" },
  { id: "deadlift", name: "Deadlift", category: "Deadlift" },
  { id: "sumo-deadlift", name: "Sumo Deadlift", category: "Deadlift" },
  { id: "deficit-deadlift", name: "Deficit Deadlift", category: "Deadlift" },
  { id: "romanian-deadlift", name: "Romanian Deadlift", category: "Deadlift" },
  { id: "trap-bar-deadlift", name: "Trap Bar Deadlift", category: "Deadlift" },
  { id: "stiff-leg-deadlift", name: "Stiff-Leg Deadlift", category: "Deadlift" },
  { id: "snatch-grip-deadlift", name: "Snatch-Grip Deadlift", category: "Deadlift" },
  { id: "deadlift-clusters", name: "Deadlift Clusters", category: "Deadlift" },
  { id: "rack-pull", name: "Rack Pull", category: "Deadlift" },
  { id: "block-pull", name: "Block Pull", category: "Deadlift" },
  { id: "strict-press", name: "Strict Press", category: "Press" },
  { id: "push-press", name: "Push Press", category: "Press" },
  { id: "bench-press", name: "Bench Press", category: "Press" },
  { id: "push-jerk", name: "Push Jerk", category: "Press" },
  { id: "split-jerk", name: "Split Jerk", category: "Press" },
  { id: "seated-press", name: "Seated Press", category: "Press" },
  { id: "z-press", name: "Z-Press", category: "Press" },
  { id: "single-arm-db-press", name: "Single-Arm DB Press", category: "Press", barbell: false },
  { id: "incline-bench-press", name: "Incline Bench Press", category: "Press" },
  { id: "close-grip-bench-press", name: "Close-Grip Bench Press", category: "Press" },
  { id: "landmine-press", name: "Landmine Press", category: "Press" },
  { id: "behind-the-neck-press", name: "Behind-the-Neck Press", category: "Press" },
  { id: "clean", name: "Clean (Squat Clean)", category: "Olympic" },
  { id: "power-clean", name: "Power Clean", category: "Olympic" },
  { id: "hang-clean", name: "Hang Clean", category: "Olympic" },
  { id: "hang-power-clean", name: "Hang Power Clean", category: "Olympic" },
  { id: "clean-and-jerk", name: "Clean and Jerk", category: "Olympic" },
  { id: "snatch", name: "Snatch", category: "Olympic" },
  { id: "power-snatch", name: "Power Snatch", category: "Olympic" },
  { id: "hang-snatch", name: "Hang Snatch", category: "Olympic" },
  { id: "tall-clean", name: "Tall Clean", category: "Olympic" },
  { id: "tall-snatch", name: "Tall Snatch", category: "Olympic" },
  { id: "sumo-deadlift-high-pull", name: "Sumo Deadlift High Pull", category: "Olympic" },
  { id: "muscle-snatch", name: "Muscle Snatch", category: "Olympic" },
  { id: "muscle-clean", name: "Muscle Clean", category: "Olympic" },
  { id: "snatch-pull", name: "Snatch Pull", category: "Olympic" },
  { id: "clean-pull", name: "Clean Pull", category: "Olympic" },
  { id: "snatch-balance", name: "Snatch Balance", category: "Olympic" },
  { id: "pause-snatch", name: "Pause Snatch", category: "Olympic" },
  { id: "pause-clean", name: "Pause Clean", category: "Olympic" },
  { id: "weighted-pullup", name: "Weighted Pull-Up", category: "Pull", barbell: false },
  { id: "weighted-chinup", name: "Weighted Chin-Up", category: "Pull", barbell: false },
  { id: "bent-over-row", name: "Bent-Over Row", category: "Pull" },
  { id: "barbell-row", name: "Barbell Row", category: "Pull" },
  { id: "pendlay-row", name: "Pendlay Row", category: "Pull" },
  { id: "single-arm-db-row", name: "Single-Arm DB Row", category: "Pull", barbell: false },
  { id: "t-bar-row", name: "T-Bar Row", category: "Pull" },
  { id: "face-pull", name: "Face Pull", category: "Pull", barbell: false },
  { id: "lat-pulldown", name: "Lat Pulldown", category: "Pull", barbell: false },
  { id: "thruster", name: "Thruster", category: "Other" },
  { id: "front-rack-lunge", name: "Front Rack Lunge", category: "Other" },
  { id: "weighted-dip", name: "Weighted Dip", category: "Other", barbell: false },
  { id: "turkish-getup", name: "Turkish Get-Up", category: "Other", barbell: false },
  { id: "good-mornings", name: "Good Mornings", category: "Other" },
  { id: "hip-thrust", name: "Hip Thrust", category: "Other" },
  { id: "barbell-lunge", name: "Barbell Lunge", category: "Other" },
  { id: "weighted-step-up", name: "Weighted Step-Up", category: "Other", barbell: false },
  { id: "nordic-curl", name: "Nordic Curl", category: "Other", barbell: false },
  { id: "ghd-hip-extension", name: "GHD Hip Extension", category: "Other", barbell: false },
  { id: "weighted-plank", name: "Weighted Plank", category: "Other", barbell: false },
  { id: "ab-wheel-rollout", name: "Ab Wheel Rollout", category: "Other", barbell: false },
  { id: "leg-press", name: "Leg Press", category: "Other", barbell: false },
  { id: "leg-curl", name: "Leg Curl", category: "Other", barbell: false },
  { id: "leg-extension", name: "Leg Extension", category: "Other", barbell: false },
  { id: "calf-raise", name: "Calf Raise", category: "Other", barbell: false },
];

const STANDARD_REPS = [1, 2, 3, 5, 10];
const BAR_OPTIONS = [20, 15, 8];
const WOD_MOVEMENT_TAGS = [
  // Gymnastics (bodyweight)
  { name: "Air Squat", category: "Gymnastics" },
  { name: "Pistols (Single-Leg Squat)", category: "Gymnastics" },
  { name: "Push-Ups", category: "Gymnastics" },
  { name: "Pull-Ups", category: "Gymnastics" },
  { name: "Chest-to-Bar Pull-Ups", category: "Gymnastics" },
  { name: "Strict Pull-Ups", category: "Gymnastics" },
  { name: "Bar Muscle-Ups", category: "Gymnastics" },
  { name: "Ring Muscle-Ups", category: "Gymnastics" },
  { name: "Ring Dips", category: "Gymnastics" },
  { name: "Handstand Push-Ups", category: "Gymnastics" },
  { name: "Handstand Walk", category: "Gymnastics" },
  { name: "Wall Walks", category: "Gymnastics" },
  { name: "Toes-to-Bar", category: "Gymnastics" },
  { name: "Knees-to-Elbows", category: "Gymnastics" },
  { name: "Sit-Ups", category: "Gymnastics" },
  { name: "GHD Sit-Ups", category: "Gymnastics" },
  { name: "Burpees", category: "Gymnastics" },
  { name: "Burpee Box Jump-Overs", category: "Gymnastics" },
  { name: "Box Jumps", category: "Gymnastics" },
  { name: "Box Step-Ups", category: "Gymnastics" },
  { name: "Rope Climbs", category: "Gymnastics" },
  { name: "Double-Unders", category: "Gymnastics" },
  { name: "Single-Unders", category: "Gymnastics" },
  { name: "L-Sit", category: "Gymnastics" },
  { name: "Pike Push-Ups", category: "Gymnastics" },
  { name: "Deficit Push-Ups", category: "Gymnastics" },
  { name: "Ring Rows", category: "Gymnastics" },
  { name: "Australian Pull-Ups", category: "Gymnastics" },
  { name: "Banded Pull-Ups", category: "Gymnastics" },
  { name: "Kipping Pull-Ups", category: "Gymnastics" },
  { name: "Ring Support Hold", category: "Gymnastics" },
  { name: "Ring Push-Ups", category: "Gymnastics" },
  { name: "Broad Jump", category: "Gymnastics" },
  { name: "Tuck-Ups", category: "Gymnastics" },
  { name: "V-Ups", category: "Gymnastics" },
  { name: "Hollow Rocks", category: "Gymnastics" },
  { name: "Superman Hold", category: "Gymnastics" },
  { name: "Plank Hold", category: "Gymnastics" },
  { name: "Side Plank", category: "Gymnastics" },
  { name: "Bear Crawl", category: "Gymnastics" },
  { name: "Crab Walk", category: "Gymnastics" },
  { name: "Inchworm", category: "Gymnastics" },
  { name: "Mountain Climbers", category: "Gymnastics" },
  { name: "Jumping Lunges", category: "Gymnastics" },
  { name: "Jump Squats", category: "Gymnastics" },
  { name: "Star Jumps", category: "Gymnastics" },
  { name: "Skater Jumps", category: "Gymnastics" },
  { name: "Wall Sit", category: "Gymnastics" },
  // Weightlifting (barbell)
  { name: "Back Squat", category: "Weightlifting" },
  { name: "Front Squat", category: "Weightlifting" },
  { name: "Overhead Squat", category: "Weightlifting" },
  { name: "Deadlift", category: "Weightlifting" },
  { name: "Sumo Deadlift", category: "Weightlifting" },
  { name: "Romanian Deadlift", category: "Weightlifting" },
  { name: "Clean", category: "Weightlifting" },
  { name: "Power Clean", category: "Weightlifting" },
  { name: "Hang Clean", category: "Weightlifting" },
  { name: "Hang Power Clean", category: "Weightlifting" },
  { name: "Clean and Jerk", category: "Weightlifting" },
  { name: "Snatch", category: "Weightlifting" },
  { name: "Power Snatch", category: "Weightlifting" },
  { name: "Hang Snatch", category: "Weightlifting" },
  { name: "Split Jerk", category: "Weightlifting" },
  { name: "Push Jerk", category: "Weightlifting" },
  { name: "Push Press", category: "Weightlifting" },
  { name: "Strict Press", category: "Weightlifting" },
  { name: "Bench Press", category: "Weightlifting" },
  { name: "Thruster", category: "Weightlifting" },
  { name: "Sumo Deadlift High Pull", category: "Weightlifting" },
  { name: "Good Mornings", category: "Weightlifting" },
  { name: "Muscle Snatch", category: "Weightlifting" },
  { name: "Muscle Clean", category: "Weightlifting" },
  { name: "Snatch Balance", category: "Weightlifting" },
  { name: "Snatch Pull", category: "Weightlifting" },
  { name: "Clean Pull", category: "Weightlifting" },
  { name: "Tall Clean", category: "Weightlifting" },
  { name: "Tall Snatch", category: "Weightlifting" },
  { name: "Front Rack Lunge", category: "Weightlifting" },
  { name: "Overhead Lunge", category: "Weightlifting" },
  { name: "Zercher Squat", category: "Weightlifting" },
  { name: "Bulgarian Split Squat", category: "Weightlifting" },
  { name: "Box Squat", category: "Weightlifting" },
  // Dumbbell
  { name: "DB Snatch", category: "Dumbbell" },
  { name: "DB Clean", category: "Dumbbell" },
  { name: "DB Clean and Jerk", category: "Dumbbell" },
  { name: "DB Thruster", category: "Dumbbell" },
  { name: "DB Push Press", category: "Dumbbell" },
  { name: "DB Overhead Squat", category: "Dumbbell" },
  { name: "DB Front Squat", category: "Dumbbell" },
  { name: "DB Deadlift", category: "Dumbbell" },
  { name: "DB Lunges", category: "Dumbbell" },
  { name: "DB Man Makers", category: "Dumbbell" },
  { name: "Devil Press", category: "Dumbbell" },
  { name: "DB Box Step-Overs", category: "Dumbbell" },
  { name: "DB Hang Clean", category: "Dumbbell" },
  { name: "DB Hang Snatch", category: "Dumbbell" },
  { name: "DB Renegade Row", category: "Dumbbell" },
  { name: "DB Bench Press", category: "Dumbbell" },
  { name: "DB Single-Arm Overhead Squat", category: "Dumbbell" },
  { name: "DB Walking Lunge", category: "Dumbbell" },
  { name: "DB Floor Press", category: "Dumbbell" },
  // Kettlebell
  { name: "KB Swings (Russian)", category: "Kettlebell" },
  { name: "KB Swings (American)", category: "Kettlebell" },
  { name: "KB Snatch", category: "Kettlebell" },
  { name: "KB Clean", category: "Kettlebell" },
  { name: "KB Goblet Squat", category: "Kettlebell" },
  { name: "KB Overhead Squat", category: "Kettlebell" },
  { name: "Turkish Get-Up", category: "Kettlebell" },
  { name: "KB Single-Arm Swing", category: "Kettlebell" },
  { name: "KB Windmill", category: "Kettlebell" },
  { name: "KB Lunge", category: "Kettlebell" },
  { name: "KB Press", category: "Kettlebell" },
  { name: "KB Thruster", category: "Kettlebell" },
  // Odd object / carries
  { name: "Wall Balls", category: "Odd Object" },
  { name: "Farmers Carry", category: "Odd Object" },
  { name: "Sandbag Cleans", category: "Odd Object" },
  { name: "Sandbag Carry", category: "Odd Object" },
  { name: "Sled Push", category: "Odd Object" },
  { name: "Sled Pull", category: "Odd Object" },
  { name: "Yoke Carry", category: "Odd Object" },
  { name: "Atlas Stone to Shoulder", category: "Odd Object" },
  { name: "Tire Flip", category: "Odd Object" },
  { name: "Sledgehammer Swings", category: "Odd Object" },
  { name: "Sandbag Over Shoulder", category: "Odd Object" },
  { name: "Keg Carry", category: "Odd Object" },
  { name: "D-Ball Cleans", category: "Odd Object" },
  { name: "Zercher Carry", category: "Odd Object" },
  // Monostructural
  { name: "Run (Meters)", category: "Monostructural" },
  { name: "Row (Meters)", category: "Monostructural" },
  { name: "Row (Calories)", category: "Monostructural" },
  { name: "Bike (Calories)", category: "Monostructural" },
  { name: "Assault Bike (Calories)", category: "Monostructural" },
  { name: "Ski Erg (Calories)", category: "Monostructural" },
  { name: "Swim (Meters)", category: "Monostructural" },
  { name: "Echo Bike (Calories)", category: "Monostructural" },
  { name: "Shuttle Runs (Meters)", category: "Monostructural" },
  { name: "Sprint (Meters)", category: "Monostructural" },
];
const WOD_MOVE_CATEGORIES_WITH_WEIGHT = new Set(["Weightlifting", "Dumbbell", "Kettlebell", "Odd Object"]);
const WOD_MOVE_CATEGORIES = ["Gymnastics", "Weightlifting", "Dumbbell", "Kettlebell", "Odd Object", "Monostructural"];
const WOD_LIBRARY = [
  { id: "fran", name: "Fran", category: "Girls", scoreType: "time", desc: "21-15-9 Thrusters & Pull-ups" },
  { id: "grace", name: "Grace", category: "Girls", scoreType: "time", desc: "30 Clean & Jerks" },
  { id: "isabel", name: "Isabel", category: "Girls", scoreType: "time", desc: "30 Snatches" },
  { id: "diane", name: "Diane", category: "Girls", scoreType: "time", desc: "21-15-9 Deadlifts & HSPU" },
  { id: "elizabeth", name: "Elizabeth", category: "Girls", scoreType: "time", desc: "21-15-9 Cleans & Ring Dips" },
  { id: "karen", name: "Karen", category: "Girls", scoreType: "time", desc: "150 Wall Balls for time" },
  { id: "annie", name: "Annie", category: "Girls", scoreType: "time", desc: "50-40-30-20-10 Double-unders & Sit-ups" },
  { id: "helen", name: "Helen", category: "Girls", scoreType: "time", desc: "3 rounds: 400m run, 21 KB swings, 12 pull-ups" },
  { id: "nancy", name: "Nancy", category: "Girls", scoreType: "time", desc: "5 rounds: 400m run, 15 OHS" },
  { id: "jackie", name: "Jackie", category: "Girls", scoreType: "time", desc: "1000m row, 50 thrusters, 30 pull-ups" },
  { id: "angie", name: "Angie", category: "Girls", scoreType: "time", desc: "100 pull-ups, push-ups, sit-ups, squats" },
  { id: "cindy", name: "Cindy", category: "Girls", scoreType: "amrap", desc: "AMRAP 20: 5 pull-ups, 10 push-ups, 15 squats" },
  { id: "mary", name: "Mary", category: "Girls", scoreType: "amrap", desc: "AMRAP 20: 5 HSPU, 10 pistols, 15 pull-ups" },
  { id: "kelly", name: "Kelly", category: "Girls", scoreType: "time", desc: "5 rounds: 400m run, 30 box jumps, 30 wall balls" },
  { id: "eva", name: "Eva", category: "Girls", scoreType: "time", desc: "5 rounds: 800m run, 30 KB swings, 30 pull-ups" },
  { id: "barbara", name: "Barbara", category: "Girls", scoreType: "time", desc: "5 rounds: 20 pull-ups, 30 push-ups, 40 sit-ups, 50 squats" },
  { id: "filthy-fifty", name: "Filthy Fifty", category: "Girls", scoreType: "time", desc: "50 reps each of 10 movements, for time" },
  { id: "chelsea", name: "Chelsea", category: "Girls", scoreType: "time", desc: "EMOM 30: 5 pull-ups, 10 push-ups, 15 air squats" },
  { id: "amanda", name: "Amanda", category: "Girls", scoreType: "time", desc: "9-7-5 Muscle-ups & Squat Snatches" },
  { id: "linda", name: "Linda", category: "Girls", scoreType: "time", desc: "10-9-8...1: Deadlift (1.5BW), Bench (BW), Clean (0.75BW)" },
  { id: "fight-gone-bad", name: "Fight Gone Bad", category: "Girls", scoreType: "amrap", desc: "3 rounds, 1 min/station: wall ball, SDHP, box jump, push press, row (cal), 1 min rest" },
  { id: "murph", name: "Murph", category: "Heroes", scoreType: "time", desc: "1mi run, 100 pull-ups, 200 push-ups, 300 squats, 1mi run" },
  { id: "dt", name: "DT", category: "Heroes", scoreType: "time", desc: "5 rounds: 12 deadlifts, 9 hang power cleans, 6 push jerks" },
  { id: "randy", name: "Randy", category: "Heroes", scoreType: "time", desc: "75 power snatches" },
  { id: "jt", name: "JT", category: "Heroes", scoreType: "time", desc: "21-15-9 HSPU, ring dips, push-ups" },
  { id: "nate", name: "Nate", category: "Heroes", scoreType: "amrap", desc: "AMRAP 20: 2 muscle-ups, 4 HSPU, 8 KB swings" },
  { id: "michael", name: "Michael", category: "Heroes", scoreType: "time", desc: "3 rounds: 800m run, 50 back extensions, 50 sit-ups" },
  { id: "danny", name: "Danny", category: "Heroes", scoreType: "amrap", desc: "AMRAP 20: 30 box jumps, 20 push press, 30 pull-ups" },
  { id: "badger", name: "Badger", category: "Heroes", scoreType: "time", desc: "3 rounds: 30 squat cleans, 30 pull-ups, 800m run" },
  { id: "the-seven", name: "The Seven", category: "Heroes", scoreType: "time", desc: "7 rounds of 7: HSPU, thrusters, K2E, deadlifts, burpees, KB swings, pull-ups" },
  { id: "hansen", name: "Hansen", category: "Heroes", scoreType: "time", desc: "5 rounds: 30 KB swings, 30 GHD sit-ups, 30 back squats" },
  { id: "glen", name: "Glen", category: "Heroes", scoreType: "time", desc: "30 clean & jerks, 1mi run, 100 burpees, 1mi run, 30 muscle-ups" },
];
const PLATE_DEFS = [
  { kg: 25, color: "#D8453C", w: 15, h: 78 },
  { kg: 20, color: "#3E6FD9", w: 15, h: 70 },
  { kg: 15, color: "#E0B23C", w: 13, h: 62 },
  { kg: 10, color: "#4B9B5F", w: 11, h: 54 },
  { kg: 5, color: "#7A828C", w: 9, h: 44 },
  { kg: 2.5, color: "#1A1A1A", w: 7, h: 34 },
  { kg: 1.25, color: "#1A1A1A", w: 6, h: 26 },
];

// ---------- Safety helpers ----------
// cssSel() and bag() moved to src/shared/safe-helpers.js in COMM-368 and are
// bound at the top of this file. catColor/catLabel stay here: they are
// prototype-safe lookups over THIS file's own tables, not shareable helpers.
// A record whose category is "__proto__" (only reachable through an imported
// backup) must never resolve to Object.prototype.
function catColor(cat) {
  return Object.prototype.hasOwnProperty.call(CATEGORY_COLORS, cat) ? CATEGORY_COLORS[cat] : "var(--steel)";
}
function catLabel(cat) {
  return Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, cat) ? CATEGORY_LABELS[cat] : String(cat ?? "");
}
const WOD_SCORE_TYPES = ["time", "amrap", "load", "emom"];
const LIMITS = {
  // idLen is read back off the shared module rather than restated here:
  // cleanId() enforces it as a security boundary and there must be exactly
  // one number, on the shared side, for the two repos to agree on.
  nameLen: 80, notesLen: 300, idLen: SAFE.LIMITS.idLen, importItems: 20000,
  weight: 1000, reps: 1000, sets: 100, minutes: 999, seconds: 59,
  rounds: 9999, bodyweight: 500, measurement: 300, duration: 3600,
  emomMovements: 20, partnerTag: 40,
};
const FIELD_MAX = {
  weight: LIMITS.weight, reps: LIMITS.reps, sets: LIMITS.sets,
  wodMinutes: LIMITS.minutes, wodSeconds: LIMITS.seconds, wodRounds: LIMITS.rounds,
  wodReps: LIMITS.reps, wodWeight: LIMITS.weight, wodScaledWeight: LIMITS.weight,
  bwWeight: LIMITS.bodyweight, durationSeconds: LIMITS.duration,
};
const MOVEMENT_CATEGORIES = ["Squat", "Deadlift", "Press", "Olympic", "Pull", "Other"];
