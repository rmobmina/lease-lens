// Level-2 explanations for the ⓘ buttons (components/info-popover.js). Short: two or three sentences,
// then an optional link to the full method (Level 3). Plain HTML; no numbers are typed in here,
// because numbers on the page are always computed from the data.

export const INFO = {
  score: {
    title: 'What does this score mean?',
    body: '<p>RentSafeTO evaluations summarize multiple building conditions into one score. Individual item ratings may reveal additional details.</p><p>Inspectors look at common areas (lobbies, halls, stairwells, grounds, systems and records), not individual units.</p>',
    more: { href: '#/about', label: 'About the data' },
  },
  'scoring-system': {
    title: 'Two scoring systems',
    body: '<p>The City changed how buildings are scored in 2023. The newer system rates up to 50 items from 0 to 3; the older one rated about 20 items from 1 to 5.</p><p>Because the items and scales differ, LeaseLens shows one system at a time and never compares scores across them.</p>',
    more: { href: '#/about', label: 'About the data' },
  },
  'lowest-10': {
    title: 'Lowest 10% and 25%',
    body: '<p>Cut-offs are citywide and use each building’s latest score in the selected scoring system. Buildings tied at the cut-off are included, so the actual share can be a little above 10% or 25%.</p><p>A low score is a reason to look closer, not a verdict on the building.</p>',
  },
  correlation: {
    title: 'Reading the age chart',
    body: '<p>Each dot is one building. The correlation (r) runs from −1 to 1; values near 0 mean year built tells you little about the score.</p><p>Buildings without a recorded year built are left out of this chart only.</p>',
  },
  problem: {
    title: 'What counts as a problem?',
    body: '',
  },
  reinspection: {
    title: 'What is a re-inspection?',
    body: '<p>The next RentSafeTO evaluation of the same building. We compare its score with the one before it: new score − previous score.</p><p>Pairs are only formed within one scoring system, so a 2021 score is never compared with a 2024 score.</p>',
  },
  movers: {
    title: 'How movers are chosen',
    body: '<p>For each building, its single largest rise (or drop) between two consecutive evaluations in the selected scoring system. Each building appears at most once per list.</p>',
  },
  'low-mark': {
    title: 'What is a low mark?',
    body: '<p>An item rated 0 or 1 on the current 0–3 scale, the two lowest marks. N/A items don’t apply and blanks were not recorded; neither is counted as a low mark or as a pass.</p>',
    more: { href: '#/about', label: 'About the data' },
  },
  'xray-controls': {
    title: 'Moving around the model',
    body: '<p><b>Exterior</b> shows the building as sourced. <b>Cutaway</b> opens one corner to show illustrative rooms. <b>Focus</b> frames one inspection category.</p><p>Drag to orbit (the cutaway follows you to the street corner you face), right-drag or two fingers to pan, scroll to zoom, double-click to fly to a point. Choose a room, a label or a category in the list to focus it; Esc returns to the whole building. The camera always stays outside the building.</p>',
    more: { href: '#/help', label: 'Help' },
  },
  'xray-model': {
    title: 'About this model',
    body: '<p>Items are rated 0–3 (2023 – now), where 3 is the top mark; 0 or 1 counts as <b>rated poorly</b>. N/A items don’t apply and are never counted. A room’s floor tint shows its category’s status. It is not a certified safety-risk score.</p><p>The rooms in the cutaway are the same generic spaces for every building. They do not show the real floor plan, and an inspection result is never located in a particular room or unit. “How this works” under the model has the full method.</p>',
  },
  'map-wards': {
    title: 'Reading the ward map',
    body: '<p>Each ward is shaded by the share of its evaluated buildings whose latest score is in Toronto’s lowest 10%. Red wards are above the citywide share, blue wards below it, grey about the same.</p><p>A dashed outline marks wards with fewer than 30 evaluated buildings, where a few buildings move the share a lot. Ward boundaries are the City’s 25-ward model.</p><p>“Lowest 10%” is a citywide cut-off on each building’s latest score in the scoring system chosen under Layers. The two systems are never mixed.</p>',
    more: { href: '#/about', label: 'About the data' },
  },
  'map-areas': {
    title: 'Reading the groups',
    body: '<p>Between the city and street scales, nearby buildings are grouped so that groups never crowd each other on screen. Each group splits into smaller ones as you zoom in, and they merge back as you zoom out. The number and the circle’s size show how many buildings a group holds; the red part of its ring shows the share of them in the lowest 10%, the blue part the rest.</p><p>Select a group, or keep zooming, to separate it into buildings.</p>',
  },
  'map-buildings': {
    title: 'Reading the building marks',
    body: '<p>One mark per building, at the address point in the RentSafeTO record, coloured by its latest score in the chosen scoring system. Larger, darker red marks are the lowest 10%; light red the next 15%; grey the rest.</p><p>A selected building’s outline comes from the City’s 3D Massing data where its address matched one footprint reliably.</p>',
  },
  layers: {
    title: 'Map layers and analysis',
    body: '<p>The scoring system and the buildings shown apply to the map and to every analysis layer. One analysis layer opens at a time beside the map; it covers the selected ward, or all of Toronto when no ward is selected.</p>',
  },
  categories: {
    title: 'Inspection categories',
    body: '<p>LeaseLens groups the inspection items into five categories: exterior envelope, shared spaces, building systems, parking, grounds and waste, and safety and records. The grouping is ours, based on the item names; the City publishes the items, not the groups.</p>',
    more: { href: '#/help', label: 'Help' },
  },
  limits: {
    title: 'What this data can’t tell you',
    body: '<p>Scores describe the common areas on inspection day, not individual units, rents or landlord practices. Patterns are associations, not causes. Buildings without coordinates count in their ward but can’t be placed on the map.</p>',
    more: { href: '#/about', label: 'About the data' },
  },
  atlas: {
    title: 'How this drawing is made',
    body: '<p>Building footprints and heights come from the City of Toronto’s 3D Massing data; streets and the shoreline from the Toronto Centreline. Blue outlines are RentSafeTO-evaluated buildings whose footprint matched reliably.</p><p>It is simplified, not traced from map imagery: small buildings, lanes and trails are left out and outlines are smoothed to about 1.6 m.</p><p>LeaseLens is an independent student-built project. It is not an official City of Toronto service.</p>',
    more: { href: '#/about', label: 'What is real and what is drawn' },
  },
  story: {
    title: 'About this story',
    body: '<p>Every example in the story is a real building, chosen by a rule you can reproduce: the most and least flagged buildings at the median score. Numbers are computed from the current data when the page loads. You can leave at any time; the map comes back as you left it.</p>',
    more: { href: '#/about', label: 'How LeaseLens works' },
  },
};
