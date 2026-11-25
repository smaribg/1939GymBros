// What a workout's total weight equals in WW2 hardware. Add or remove items freely: [name, kg, icon].
// Tanks and trucks are combat-ready weights, planes are empty, all approximate. Icons are at the bottom.
const WW2_ITEMS = [
  // tanks and armour
  ['Tiger II', 69800, 'tank'], ['Tiger I', 57000, 'tank'], ['KV-1', 45000, 'tank'], ['Panther', 44800, 'tank'],
  ['Churchill tank', 39600, 'tank'], ['T-34/85', 32000, 'tank'], ['Sherman', 30300, 'tank'], ['Cromwell tank', 28000, 'tank'],
  ['T-34/76', 26500, 'tank'], ['Panzer IV', 25000, 'tank'], ['StuG III', 23900, 'stug'], ['Panzer III', 21500, 'tank'],
  ['Chaffee tank', 18400, 'tank'], ['Stuart tank', 14700, 'tank'], ['Panzer 38(t)', 9700, 'tank'], ['Panzer II', 8900, 'tank'],
  ['Sd.Kfz. 251 half-track', 7800, 'halftrack'], ['Panzer I', 5400, 'tank'],
  // planes
  ['Lancaster bomber', 16600, 'bomber'], ['B-17 Flying Fortress', 16400, 'bomber'], ['C-47 Skytrain', 8200, 'twin'],
  ['Mosquito', 6500, 'twin'], ['P-47 Thunderbolt', 4500, 'fighter'], ['Il-2 Sturmovik', 4360, 'fighter'], ['Stuka', 3900, 'fighter'],
  ['P-51 Mustang', 3465, 'fighter'], ['Fw 190', 3200, 'fighter'], ['Hurricane', 2600, 'fighter'], ['Spitfire', 2300, 'fighter'],
  ['Bf 109', 2250, 'fighter'], ['Yak-3', 2100, 'fighter'], ['Zero', 1680, 'fighter'],
  // guns
  ['88 mm Flak gun', 7400, 'gun'], ['Bofors 40 mm gun', 2000, 'gun'], ['25-pounder gun', 1630, 'gun'], ['Pak 40 gun', 1425, 'gun'],
  ['6-pounder gun', 1140, 'gun'], ['Flak 38 gun', 450, 'gun'], ['Pak 36 gun', 328, 'gun'], ['81 mm mortar', 62, 'mortar'],
  // vehicles
  ['Kettenkrad', 1235, 'halftrack'], ['Willys Jeep', 1040, 'jeep'], ['Kübelwagen', 725, 'jeep'], ['BMW R75 motorcycle', 420, 'moto'],
  ['Harley-Davidson WLA', 245, 'moto'], ['DKW NZ 350 motorcycle', 145, 'moto'], ['DKW RT 125 motorcycle', 90, 'moto'],
  ['Welbike', 32, 'moto'],
  // what you can carry
  ['M2 Browning', 38, 'mg'], ['full jerrycan', 20, 'jerrycan'], ['PIAT', 15, 'launcher'], ['MG 42', 11.6, 'mg'],
  ['Bazooka', 6.8, 'launcher'], ['Thompson', 4.9, 'smg'], ['M1 Garand', 4.3, 'rifle'], ['Kar98k', 4.1, 'rifle'],
  ['PPSh-41', 3.6, 'smg'], ['M1 helmet', 1.3, 'helmet'], ['Luger', 0.9, 'pistol'],
].sort((a, b) => b[1] - a[1]);

// Breaks a weight down into at most four kinds of items, big to small, until less than 1% is left over.
// `seed` (the workout's id) decides between items of similar weight, so a workout looks the same on every phone.
function ww2Units(kg, seed) {
  const luck = name => {
    let h = 2166136261;
    for (const c of seed + name) h = Math.imul(h ^ c.codePointAt(0), 16777619);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); // spreads out similar strings
    return (h ^ (h >>> 16)) >>> 0;
  };
  const out = [];
  for (let rest = kg; rest > 0 && rest >= kg * 0.01 && out.length < 4;) {
    const fits = WW2_ITEMS.filter(([, w]) => w <= rest);
    if (!fits.length) break;
    const close = fits.filter(([, w]) => w >= rest / 2);
    const [name, w, icon] = close.length ? close.reduce((a, b) => (luck(b[0]) > luck(a[0]) ? b : a)) : fits[0];
    const count = Math.floor(rest / w);
    out.push({ name, count, kg: w, icon });
    rest -= count * w;
  }
  return out;
}

// Silhouettes (64 × 32, filled with the text color)
const wheels = (r, ...xs) => xs.map(x => `<circle cx="${x}" cy="${30 - r}" r="${r}"/>`).join('');
const TRACKS = '<path fill-rule="evenodd" d="M9 19h46a5.5 5.5 0 0 1 0 11H9a5.5 5.5 0 0 1 0-11zM11 22a2.5 2.5 0 1 0 .01 0zM21 22a2.5 2.5 0 1 0 .01 0zM32 22a2.5 2.5 0 1 0 .01 0zM43 22a2.5 2.5 0 1 0 .01 0zM53 22a2.5 2.5 0 1 0 .01 0z"/>';
const WW2_ICONS = {
  tank: '<path d="M18 4h16l4 3h25v2.5H39l1 3.5h8l7 4H6l3-4h6z"/>' + TRACKS,
  stug: '<path d="M14 8h22l3 3h22v2.5H43l10 3.5H7z"/>' + TRACKS,
  halftrack: '<path d="M4 8h28l6 6h16l6 3v5H4z"/><path fill-rule="evenodd" d="M9 20h26a5 5 0 0 1 0 10H9a5 5 0 0 1 0-10zM11 22.5a2.5 2.5 0 1 0 .01 0zM22 22.5a2.5 2.5 0 1 0 .01 0zM33 22.5a2.5 2.5 0 1 0 .01 0z"/>' + wheels(5, 52),
  // planes from above, nose up
  fighter: '<path d="M32 1c2 0 3 3 3 7l23 4c3 1 3 5 0 5l-23 2-1 6 7 2v3l-9 1-9-1v-3l7-2-1-6-23-2c-3 0-3-4 0-5l23-4c0-4 1-7 3-7z"/>',
  twin: '<path d="M32 0c2 0 3 4 3 8l7 1V5q2-3 4 0v5l15 3v4l-26 2-1 6 7 2v3l-9 1-9-1v-3l7-2-1-6-26-2v-4l15-3V5q2-3 4 0v4l7-1c0-4 1-8 3-8z"/>',
  bomber: '<path d="M32 0c2 0 3 4 3 8l6 .5V5q1.5-2 3 0v4l7 1V7q1.5-2 3 0v4l8 2v4l-27 2-1 6 9 2v3l-11 1-11-1v-3l9-2-1-6-27-2v-4l8-2V7q1.5-2 3 0v3l7-1V5q1.5-2 3 0v3.5l6-.5c0-4 1-8 3-8z"/>',
  gun: '<path d="M62 4l1 3-25 7V6h3v6zM26 10l12-6v18H24zM26 20L5 30l-2-3 20-12z"/><path fill-rule="evenodd" d="M32 13a8.5 8.5 0 1 0 .01 0zM32 16a5.5 5.5 0 1 1-.01 0zM32 19a2.5 2.5 0 1 0 .01 0z"/>',
  mortar: '<path d="M43 2l5 3-21 23-5-3zM37 14l3-1 11 15h-4zM10 27h24v3H10z"/>',
  jeep: '<path d="M4 13h22l5-9h3l-4 9h24l6 3v8H4z"/>' + wheels(6.5, 16, 48),
  moto: '<path fill-rule="evenodd" d="M13 12a9 9 0 1 0 .01 0zM13 16a5 5 0 1 1-.01 0zM51 12a9 9 0 1 0 .01 0zM51 16a5 5 0 1 1-.01 0z"/><path d="M13 20l8-8h15l5-2-3-5h-5V2h7l12 18-2 2-7-9-7 12H24l-4-4-6 1zM15 8h13l2 3H15z"/>',
  mg: '<path d="M2 9h10l3 2h18V9h10v2h19v2H45v3H32l-2 3h-4l-2 6h-4l2-7-9-2-9 3zM46 15h2l7 15h-3l-5-11-5 11h-3z"/>',
  launcher: '<path d="M2 9l4 2h50l6-3v10l-6-3H40l-2 8h-4l1-8h-8l-2 8h-4l1-8H6l-4 2z"/>',
  rifle: '<path d="M2 15l17-4h20l1-2h3v2h19v2H47l-5 2H24l-3 5h-3l1-4-6 1-11 5z"/>',
  smg: '<path d="M2 14l16-5h26v1h18v3H44v3h-5l-1 12h-6l1-12h-8l-3 9h-5l2-9-15 5z"/>',
  pistol: '<path d="M14 6h14l3-2 4 2h16v3H35v4h-5c0 4-3 5-6 4l-3 12h-9l5-17-4-3z"/>',
  helmet: '<path d="M12 22C12 9 21 3 32 3s20 6 20 19l6 3v2c-18-4-34-4-52 0v-2z"/>',
  jerrycan: '<path fill-rule="evenodd" d="M20 8l4-5h14v3h5l3 4v17a3 3 0 0 1-3 3H23a3 3 0 0 1-3-3zM26 5h9v2h-9zM25 14l6 5-6 5 2 2 6-5 6 5 2-2-6-5 6-5-2-2-6 5-6-5z"/>',
};
const ww2Icon = kind => `<svg class="ww2-icon" viewBox="0 0 64 32" fill="currentColor" aria-hidden="true">${WW2_ICONS[kind]}</svg>`;
