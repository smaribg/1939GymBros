// What a workout's total weight equals in WW2 hardware. Add or remove items freely: [name, kg, icon].
// Tanks and trucks are combat-ready weights, planes are empty, ships are their displacement, all approximate. Icons are at the bottom.
const WW2_ITEMS = [
  // tanks and armour
  ['Tiger II', 69800, 'tank'], ['Tiger I', 57000, 'tank'], ['KV-1', 45000, 'tank'], ['Panther', 44800, 'tank'],
  ['Churchill tank', 39100, 'tank'], ['T-34/85', 32400, 'tank'], ['Sherman', 30300, 'tank'], ['Cromwell tank', 28000, 'tank'],
  ['T-34/76', 26500, 'tank'], ['Panzer IV', 25000, 'tank'], ['StuG III', 23900, 'stug'], ['Panzer III', 23000, 'tank'],
  ['Chaffee tank', 18400, 'tank'], ['Stuart tank', 15200, 'tank'], ['Panzer 38(t)', 9725, 'tank'], ['Panzer II', 8900, 'tank'],
  ['Sd.Kfz. 251 half-track', 7800, 'halftrack'], ['Panzer I', 5400, 'tank'],
  // planes
  ['Lancaster bomber', 16740, 'bomber'], ['B-17 Flying Fortress', 16390, 'bomber'], ['C-47 Skytrain', 8225, 'twin'],
  ['Mosquito', 6490, 'twin'], ['P-47 Thunderbolt', 4535, 'fighter'], ['Il-2 Sturmovik', 4425, 'fighter'], ['Stuka', 3900, 'fighter'],
  ['P-51 Mustang', 3465, 'fighter'], ['Fw 190', 3200, 'fighter'], ['Hurricane', 2600, 'fighter'], ['Spitfire', 2300, 'fighter'],
  ['Bf 109', 2250, 'fighter'], ['Yak-3', 2100, 'fighter'], ['Zero', 1680, 'fighter'],
  // guns
  ['88 mm Flak gun', 7400, 'gun'], ['Bofors 40 mm gun', 2000, 'gun'], ['25-pounder gun', 1630, 'gun'], ['Pak 40 gun', 1425, 'gun'],
  ['6-pounder gun', 1145, 'gun'], ['Flak 38 gun', 405, 'gun'], ['Pak 36 gun', 328, 'gun'], ['81 mm mortar', 62, 'mortar'],
  // vehicles
  ['Kettenkrad', 1560, 'halftrack'], ['Willys Jeep', 1110, 'jeep'], ['Kübelwagen', 725, 'jeep'], ['BMW R75 motorcycle', 420, 'moto'],
  ['Harley-Davidson WLA', 245, 'moto'], ['DKW NZ 350 motorcycle', 145, 'moto'], ['DKW RT 125 motorcycle', 90, 'moto'],
  ['Welbike', 32, 'moto'],
  // what you can carry
  ['M2 Browning', 38, 'mg'], ['full jerrycan', 20, 'jerrycan'], ['PIAT', 15, 'launcher'], ['MG 42', 11.6, 'mg'],
  ['Bazooka', 6.8, 'launcher'], ['Thompson', 4.9, 'smg'], ['M1 Garand', 4.3, 'rifle'], ['Kar98k', 4.1, 'rifle'],
  ['PPSh-41', 3.6, 'smg'], ['M1 helmet', 1.4, 'helmet'], ['Luger', 0.9, 'pistol'],
  // more, by icon
  ['KV-2', 52000, 'tank'], ['IS-2', 46000, 'tank'], ['T-28', 28000, 'tank'], ['T-26', 9600, 'tank'],
  ['BT-7', 13900, 'tank'], ['T-60', 5800, 'tank'], ['T-70', 9200, 'tank'], ['Matilda II', 25400, 'tank'],
  ['Valentine', 16300, 'tank'], ['Crusader', 19700, 'tank'], ['Comet', 35600, 'tank'],
  ['Sherman Firefly', 35300, 'tank'], ['M3 Lee', 27200, 'tank'], ['Pershing', 41900, 'tank'],
  ['M10 tank destroyer', 29600, 'tank'], ['M18 Hellcat', 17000, 'tank'], ['Ha-Go', 7400, 'tank'],
  ['Chi-Ha', 15000, 'tank'], ['Renault R35', 10600, 'tank'], ['Char B1', 28000, 'tank'], ['Somua S35', 19500, 'tank'],
  ['Renault FT', 6500, 'tank'], ['7TP', 9900, 'tank'], ['Luchs', 11800, 'tank'], ['Maus', 188000, 'tank'],
  ['Jagdtiger', 71700, 'stug'], ['Sturmtiger', 68000, 'stug'], ['Elefant', 65000, 'stug'],
  ['Jagdpanther', 45500, 'stug'], ['SU-152', 45500, 'stug'], ['SU-100', 31600, 'stug'], ['SU-85', 29600, 'stug'],
  ['Brummbär', 28200, 'stug'], ['Nashorn', 24000, 'stug'], ['Hummel', 24000, 'stug'], ['M7 Priest', 23000, 'stug'],
  ['Hetzer', 15750, 'stug'], ['Wespe', 11000, 'stug'], ['Marder III', 10670, 'stug'], ['L3 tankette', 3200, 'stug'],
  ['Bren carrier', 3860, 'stug'],
  ['M3 half-track', 8000, 'halftrack'], ['LVT Buffalo', 16500, 'halftrack'],
  ['GMC truck', 4000, 'truck'], ['DUKW', 6170, 'truck'], ['ZiS-5 truck', 3100, 'truck'],
  ['Opel Blitz', 2500, 'truck'],
  ['M8 Greyhound', 7440, 'jeep'], ['Sd.Kfz. 222 armoured car', 4000, 'jeep'], ['Dodge WC-51', 2380, 'jeep'],
  ['Schwimmwagen', 910, 'jeep'],
  ['Me 323 Gigant', 27300, 'bomber'], ['B-29 Superfortress', 33800, 'bomber'], ['Short Stirling', 22500, 'bomber'],
  ['Halifax bomber', 17180, 'bomber'], ['B-24 Liberator', 16550, 'bomber'],
  ['Ju 88', 9860, 'twin'], ['He 111', 8680, 'twin'], ['Do 17', 5200, 'twin'], ['Bf 110', 4425, 'twin'],
  ['Ju 52', 5720, 'twin'], ['Me 262', 3800, 'twin'], ['B-26 Marauder', 10890, 'twin'],
  ['B-25 Mitchell', 8850, 'twin'], ['PBY Catalina', 9480, 'twin'], ['P-38 Lightning', 5800, 'twin'],
  ['Beaufighter', 7070, 'twin'], ['Wellington bomber', 8420, 'twin'], ['Pe-2', 5950, 'twin'],
  ['Betty bomber', 6740, 'twin'],
  ['Me 163 Komet', 1905, 'fighter'], ['Fieseler Storch', 930, 'fighter'], ['P-40 Warhawk', 2690, 'fighter'],
  ['P-39 Airacobra', 2960, 'fighter'], ['F4F Wildcat', 2230, 'fighter'], ['F6F Hellcat', 4190, 'fighter'],
  ['F4U Corsair', 4170, 'fighter'], ['SBD Dauntless', 2900, 'fighter'], ['TBF Avenger', 4780, 'fighter'],
  ['Typhoon', 4010, 'fighter'], ['Tempest', 4190, 'fighter'], ['Swordfish', 1905, 'fighter'],
  ['Lysander', 1980, 'fighter'], ['Gladiator', 1460, 'fighter'], ['Tiger Moth', 506, 'fighter'],
  ['LaGG-3', 2205, 'fighter'], ['La-5', 2705, 'fighter'], ['MiG-3', 2700, 'fighter'], ['Po-2', 770, 'fighter'],
  ['I-16', 1490, 'fighter'], ['Ki-43 Oscar', 1910, 'fighter'], ['Ki-84 Frank', 2660, 'fighter'],
  ['Val dive bomber', 2570, 'fighter'], ['Kate torpedo plane', 2280, 'fighter'], ['Macchi C.202', 2490, 'fighter'],
  ['Fiat CR.42', 1780, 'fighter'], ['Piper Cub', 345, 'fighter'], ['Waco glider', 1770, 'fighter'],
  ['Horsa glider', 3800, 'fighter'],
  ['Long Tom 155 mm gun', 13880, 'gun'], ['ML-20 howitzer', 7270, 'gun'], ['sFH 18 howitzer', 5510, 'gun'],
  ['Pak 43 gun', 3650, 'gun'], ['17-pounder gun', 2100, 'gun'], ['M2 105 mm howitzer', 2260, 'gun'],
  ['leFH 18 howitzer', 1985, 'gun'], ['ZiS-2 gun', 1250, 'gun'], ['ZiS-3 gun', 1116, 'gun'],
  ['Pak 38 gun', 1000, 'gun'], ['2-pounder gun', 800, 'gun'], ['75 mm pack howitzer', 650, 'gun'],
  ['leIG 18 infantry gun', 400, 'gun'],
  ['120 mm mortar', 280, 'mortar'], ['60 mm mortar', 19, 'mortar'], ['50 mm light mortar', 14, 'mortar'],
  ['airborne folding bicycle', 10.5, 'bike'],
  ['Maxim M1910', 62.7, 'mg'], ['Vickers gun', 23, 'mg'], ['Lewis gun', 12.7, 'mg'], ['MG 34', 12.1, 'mg'],
  ['Bren gun', 10.3, 'mg'], ['DP-27', 9.1, 'mg'], ['BAR', 8.8, 'mg'],
  ['Panzerschreck', 11, 'launcher'], ['Panzerfaust', 6.3, 'launcher'],
  ['PTRD anti-tank rifle', 16, 'rifle'], ['Boys anti-tank rifle', 16, 'rifle'], ['Lee-Enfield', 4.1, 'rifle'],
  ['Mosin-Nagant', 4, 'rifle'], ['M1 Carbine', 2.4, 'rifle'],
  ['StG 44', 4.6, 'smg'], ['MP 40', 4, 'smg'], ['Sten gun', 3.2, 'smg'],
  ['Webley revolver', 1.1, 'pistol'], ['Colt M1911', 1.1, 'pistol'], ['Tokarev pistol', 0.85, 'pistol'],
  ['Stahlhelm', 1.2, 'helmet'],
  ['SCR-300 radio', 14.5, 'box'], ['Enigma machine', 12, 'box'],
  ['BR 52 locomotive', 84000, 'train'], ['Schwerer Gustav rail gun', 1350000, 'train'],
  ['Type XXIII U-boat', 234000, 'sub'], ['Type VII U-boat', 769000, 'sub'], ['Gato submarine', 1549000, 'sub'],
  ['Higgins boat', 8165, 'ship'], ['PT boat', 51000, 'ship'], ['S-boat', 100000, 'ship'],
  ['Flower-class corvette', 940000, 'ship'], ['Fletcher destroyer', 2080000, 'ship'],
  ['HMS Belfast', 11735000, 'ship'], ['Bismarck', 41700000, 'ship'], ['Yamato', 65027000, 'ship'],
  // famous additions
  ['Karl-Gerät siege mortar', 124000, 'gun'], ['T28 super-heavy tank', 86200, 'stug'], ['Tortoise assault tank', 79200, 'stug'],
  ['BV 238 flying boat', 54780, 'bomber'], ['StuG IV', 23000, 'stug'], ['Fw 200 Condor', 17005, 'bomber'],
  ['Short Sunderland', 15650, 'bomber'], ['P-61 Black Widow', 10640, 'twin'], ['SM.79 Sparviero', 7700, 'twin'],
  ['Me 410 Hornisse', 7520, 'twin'], ['A-20 Havoc', 7270, 'twin'], ['Gloster Meteor', 4845, 'twin'],
  ['SB2C Helldiver', 4785, 'fighter'], ['Yak-9', 2510, 'fighter'], ['He 162 Volksjäger', 1660, 'fighter'],
  ['Biber midget submarine', 5700, 'sub'], ['Seehund midget submarine', 17000, 'sub'], ['Ko-hyoteki midget submarine', 46000, 'sub'],
  ['Liberty ship', 14470000, 'ship'], ['USS Enterprise', 20120000, 'ship'], ['HMS Hood', 47430000, 'ship'],
].sort((a, b) => b[1] - a[1]);

// A fixed random number per item for a seed
const ww2Luck = seed => name => {
  let h = 2166136261;
  for (const c of seed + name) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  // spreads out similar strings
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};

// Breaks a weight down into at most four kinds of items, big to small, until less than 1% is left over.
// `seed` (the workout's id) decides between items of similar weight, so a workout looks the same on every phone.
function ww2Units(kg, seed) {
  const luck = ww2Luck(seed);
  const out = [];
  for (let rest = kg; rest > 0 && rest >= kg * 0.01 && out.length < 4;) {
    const fits = WW2_ITEMS.filter(([, w]) => w <= rest);
    if (!fits.length) break;
    // First the heaviest that fits (or within 1% of it), then anything filling at least half of what's left
    const close = fits.filter(([, w]) => w >= (out.length ? rest / 2 : fits[0][1] * 0.99));
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
  bike: '<path fill-rule="evenodd" d="M14 13a8.5 8.5 0 1 0 .01 0zM14 15.5a6 6 0 1 1-.01 0zM50 13a8.5 8.5 0 1 0 .01 0zM50 15.5a6 6 0 1 1-.01 0z"/><path d="M13 21l9-13h-4V6h9v2h-2l-1 2h18l-2-5h-5V3h7l9 18-2 1-5-10-11 11h-19zM25 12l7 9 8-9zM23 13l-6 8h12z" fill-rule="evenodd"/>',
  truck: '<path d="M3 6h36v17H3zM41 10h8l5 6 7 2v5H41z"/>' + wheels(5.5, 13, 27, 52),
  box: '<path fill-rule="evenodd" d="M16 8h32a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2zM22 13a4 4 0 1 0 .01 0zM34 13v3h11v-3zM34 19v3h11v-3zM19 25v2h26v-2zM45 2h2v6h-2z"/>',
  train: '<path d="M3 5h15v18H3zM18 10h34a6 6 0 0 1 0 12H18zM44 3h6v7h-6zM28 7h6v4h-6zM55 22h6l3 4h-9z"/>' + wheels(4.5, 9, 21, 32, 43, 54),
  sub: '<path d="M8 19h16l3-9h9l3 9h16c5 0 7 3 8 4-1 1-4 5-9 5H14C8 28 4 25 1 22zM30 3h2.5v8H30zM33 5h3v2h-3zM14 15h8v2h-3v3h-3v-3h-2z"/>',
  ship: '<path d="M2 20h12v-5h8v-5h6V3h3v7h6v5h10l2 5h13l-6 9H8zM6 16h6v4H6zM2 16h6v1.5H2zM50 16h6v4h-6zM55 16h7v1.5h-7z"/>',
  jerrycan: '<path fill-rule="evenodd" d="M20 8l4-5h14v3h5l3 4v17a3 3 0 0 1-3 3H23a3 3 0 0 1-3-3zM26 5h9v2h-9zM25 14l6 5-6 5 2 2 6-5 6 5 2-2-6-5 6-5-2-2-6 5-6-5z"/>',
};
const ww2Icon = kind => `<svg class="ww2-icon" viewBox="0 0 64 32" fill="currentColor" aria-hidden="true">${WW2_ICONS[kind]}</svg>`;
