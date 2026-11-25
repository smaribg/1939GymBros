// What a workout's total weight equals in WW2 hardware. Add or remove items freely: [name, kg].
// Tanks and trucks are combat-ready weights, planes are empty, both approximate.
const WW2_ITEMS = [
  // tanks and armour
  ['Tiger II', 69800], ['Tiger I', 57000], ['KV-1', 45000], ['Panther', 44800], ['Churchill tank', 39600],
  ['T-34/85', 32000], ['Sherman', 30300], ['Cromwell tank', 28000], ['T-34/76', 26500], ['Panzer IV', 25000],
  ['StuG III', 23900], ['Panzer III', 21500], ['Chaffee tank', 18400], ['Stuart tank', 14700],
  ['Panzer 38(t)', 9700], ['Panzer II', 8900], ['Sd.Kfz. 251 half-track', 7800], ['Panzer I', 5400],
  // planes
  ['Lancaster bomber', 16600], ['B-17 Flying Fortress', 16400], ['C-47 Skytrain', 8200], ['Mosquito', 6500],
  ['P-47 Thunderbolt', 4500], ['Il-2 Sturmovik', 4360], ['Stuka', 3900], ['P-51 Mustang', 3465], ['Fw 190', 3200],
  ['Hurricane', 2600], ['Spitfire', 2300], ['Bf 109', 2250], ['Yak-3', 2100], ['Zero', 1680],
  // rockets and bombs
  ['V-2 rocket', 12500], ['Grand Slam bomb', 10000], ['Tallboy bomb', 5440], ['V-1 flying bomb', 2150],
  ['1000 lb bomb', 450], ['500 lb bomb', 227], ['250 lb bomb', 113],
  // guns and vehicles
  ['88 mm Flak gun', 7400], ['25-pounder gun', 1630], ['Pak 40 gun', 1425], ['Kettenkrad', 1235],
  ['Willys Jeep', 1040], ['Kübelwagen', 725], ['BMW R75 motorcycle', 420], ['Goliath mini-tank', 370],
  ['Harley-Davidson WLA', 245], ['81 mm mortar', 62], ['M2 Browning', 38],
  // what you can carry
  ['full jerrycan', 20], ['PIAT', 15], ['MG 42', 11.6], ['Bazooka', 6.8], ['Thompson', 4.9], ['M1 Garand', 4.3],
  ['Kar98k', 4.1], ['PPSh-41', 3.6], ['Luger', 0.9], ['stick grenade', 0.6],
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
    const [name, w] = close.length ? close.reduce((a, b) => (luck(b[0]) > luck(a[0]) ? b : a)) : fits[0];
    const count = Math.floor(rest / w);
    out.push({ name, count, kg: w });
    rest -= count * w;
  }
  return out;
}
