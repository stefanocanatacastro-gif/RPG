// Showcase fights: ready-made encounters that show off different line-ups,
// sizes, bosses, ring hazards, goals, crowds and partners. They're listed in
// Encounters, and can be copied into the sandbox to remix.

import type { BattleSetup } from '../managers/battle_setup';

export interface Scenario {
  id: string;
  title: string;
  /** One or two sentences: what makes this fight different. */
  desc: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'very hard';
  setup: BattleSetup;
}

/** Kid Chispa at a given point in the story: starting numbers, or after a few level-ups. */
const chispa = (level: 1 | 2 | 3) =>
  ({
    1: { hero: 'chispa', maxHp: 10, attack: 1, defence: 0, grit: 5 },
    2: { hero: 'chispa', maxHp: 15, attack: 2, defence: 0, grit: 8 },
    3: { hero: 'chispa', maxHp: 20, attack: 2, defence: 1, grit: 10 },
  })[level];

export const SCENARIOS: Scenario[] = [
  {
    id: 'dock_rumble',
    difficulty: 'easy',
    title: 'Dockside Rumble',
    desc: 'Three Dock Goons in a quiet dockside ring. A gentle first fight to learn the timing.',
    setup: {
      ...chispa(1),
      partner: null,
      enemies: [
        { id: 'dock_goon', slot: 'front' },
        { id: 'dock_goon', slot: 'front' },
        { id: 'dock_goon', slot: 'back' },
      ],
      stage: 'dockside',
      firstStrike: 'player',
      items: ['water_bottle'],
      conditions: { crowd: 'quiet' },
    },
  },
  {
    id: 'air_raid',
    difficulty: 'easy',
    title: 'Air Raid',
    desc: 'Two Gull Flyers overhead and a Spiky Bouncer up front, on a slippery canvas. Pick moves that reach the air, and mind the spikes.',
    setup: {
      ...chispa(1),
      partner: 'pip',
      enemies: [
        { id: 'spiky_bouncer', slot: 'front' },
        { id: 'gull_flyer', slot: 'air' },
        { id: 'gull_flyer', slot: 'air' },
      ],
      stage: 'dockside',
      firstStrike: null,
      items: ['water_bottle', 'steel_chair'],
      conditions: { hazards: ['slippery_canvas'] },
    },
  },
  {
    id: 'corner_crew',
    difficulty: 'medium',
    title: 'Beat the Clock',
    desc: 'A Ringside Bruiser, a Goon and a Corner Medic who keeps patching them up. Win inside 4 rounds, in front of a packed, rowdy crowd.',
    setup: {
      ...chispa(1),
      partner: 'pip',
      enemies: [
        { id: 'ringside_bruiser', slot: 'front' },
        { id: 'dock_goon', slot: 'front' },
        { id: 'corner_medic', slot: 'back' },
      ],
      stage: 'arena',
      firstStrike: null,
      items: ['steel_chair', 'protein_shake'],
      conditions: { goal: 'timed', rounds: 4, crowd: 'packed', mood: 'rowdy' },
    },
  },
  {
    id: 'rafter_king',
    difficulty: 'medium',
    title: 'The Rafter King',
    desc: 'A boss who drops in from the lighting rig and gets serious at half HP. Lights fall, a spotlight wanders, and the home crowd is with you.',
    setup: {
      ...chispa(2),
      partner: 'pip',
      enemies: [
        { id: 'rafter_king', slot: 'front' },
        { id: 'corner_medic', slot: 'back' },
      ],
      stage: 'arena',
      firstStrike: null,
      items: ['water_bottle', 'protein_shake'],
      conditions: { hazards: ['falling_light', 'spotlight'], crowd: 'packed', mood: 'home' },
    },
  },
  {
    id: 'pier_9',
    difficulty: 'hard',
    title: 'Pier 9 Heavyweight',
    desc: 'Tugboat Tony is a big one with two Goons in his corner, and the ropes are on fire. Big fighters push the line-up back.',
    setup: {
      ...chispa(2),
      partner: null,
      enemies: [
        { id: 'tugboat_tony', slot: 'front' },
        { id: 'dock_goon', slot: 'front' },
        { id: 'dock_goon', slot: 'back' },
      ],
      stage: 'arena',
      firstStrike: null,
      items: ['water_bottle', 'water_bottle', 'steel_chair'],
      conditions: { hazards: ['burning_ropes'], crowd: 'normal', mood: 'away' },
    },
  },
  {
    id: 'hold_the_wall',
    difficulty: 'hard',
    title: 'Hold the Wall',
    desc: 'Agent Brick walks in, huge and unstoppable. You don’t have to win: stay standing for 4 rounds. No items, no running.',
    setup: {
      ...chispa(1),
      partner: null,
      enemies: [
        { id: 'agent_brick', slot: 'front' },
        { id: 'dock_goon', slot: 'back' },
      ],
      stage: 'underground',
      firstStrike: null,
      items: [],
      conditions: { goal: 'survive', rounds: 4, noItems: true, noRun: true, crowd: 'packed', mood: 'away' },
    },
  },
  {
    id: 'main_event',
    difficulty: 'very hard',
    title: 'Main Event: Brick & the King',
    desc: 'Both bosses at once: a huge one and a big one, each with a second phase. Bring everything you have.',
    setup: {
      ...chispa(3),
      partner: 'pip',
      enemies: [
        { id: 'agent_brick', slot: 'front' },
        { id: 'rafter_king', slot: 'front' },
      ],
      stage: 'underground',
      firstStrike: null,
      items: ['water_bottle', 'water_bottle', 'protein_shake', 'steel_chair', 'smelling_salts'],
      conditions: { crowd: 'packed', mood: 'rowdy' },
    },
  },
];
