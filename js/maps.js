export const MAPS = [
  { id: 'small', name: 'Small island', file: 'assets/island.glb', blurb: 'The original island · 4–8 vehicles', radius: 650, ceiling: 260, radar: 340, preview: 'design/island_small.png' },
  { id: 'large', name: 'Large island', file: 'assets/island_large.glb', blurb: '7× land area · 20–28 vehicles · villages and roads', radius: 1050, ceiling: 380, radar: 620, preview: 'design/island_overview.png' },
];

export function levelForMap(level, map) {
  const trucks = map === 'large' ? [20, 24, 28][level.n - 1] : level.trucks;
  return { ...level, trucks, maxY: map === 'large' ? Math.max(35, level.maxY * 2) : level.maxY, bombs: map === 'large' ? trucks + 4 : level.bombs };
}
