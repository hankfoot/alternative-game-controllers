// Prompts to paste into an AI image or sound tool, for making a game's
// drawings and sounds there instead of by hand. Each says exactly what every
// piece is for and what shape it has to be, which is the part nobody guesses
// right: a pillar is a tall portrait whose bottom gets stretched, the ground
// repeats, the sky fills the frame. Written from the same slot list the
// Design screen draws, so a size changed there is a size changed here.

import { SLOTS, sizeOf } from './defaults.js';
import { SOUND_EVENTS } from './audio.js';

// What each drawing has to be, beyond its size, in the words an image tool
// needs. Keyed by slot id; a slot added without one still gets its size.
const SPRITE_NOTES = {
  player: 'The character the player steers. Seen from the side, facing right. One object, centred, filling most of the frame.',
  obstacle: 'A pillar the player flies past. A tall portrait: the top of the image is the end the player sees, at the edge of the gap. The bottom fifth should be a plain, even stretch of the pillar, because the game stretches it when a pillar needs to be longer. The same image is flipped upside down for pillars hanging from the top.',
  block: 'A block that hangs in mid-air for the player to dodge. One object, roughly square, filling the frame.',
  ground: 'A strip of ground, repeated side by side along the bottom of the screen. It must tile seamlessly left to right. The top edge is the surface.',
  backdrop: 'The sky, behind everything, stretched to fill the whole screen. Fill the entire frame, with no transparency and nothing important near the edges.',
  far: 'Distant scenery, like hills or a skyline, repeated across the back of the screen and scrolling slowly. It should tile left to right, sit along the bottom of the frame, and be transparent above.',
  near: 'One piece of scenery, like a tree or a rock, dotted along the ground in front of the far scenery. Standing on the bottom edge of the frame.',
  decor: 'One small thing that drifts through the air, like a cloud or a bird.',
};

// What fills the blank when nobody has described their game yet.
// Asked for whenever the tool can manage it: one download, imported in one go.
const BUNDLE = 'If you can, put all of the files together in one .zip file for me to download. If you can only make one at a time, that is fine: give each one its file name.';

const THEME = '[describe your game here, for example: an underwater game where a jellyfish dodges coral]';
const themeOf = (idea) => idea?.trim() || THEME;

/** The prompt for a whole set of drawings, one per slot, for the game `idea` describes. */
export function spritePrompt(idea = '') {
  const lines = SLOTS.map((slot) => {
    const { width, height } = sizeOf(slot.id);
    const note = SPRITE_NOTES[slot.id] ?? slot.help;
    const clear = slot.id === 'backdrop' ? 'Opaque PNG.' : 'PNG with a transparent background.';
    return `- \`${slot.id}.png\` — **${slot.label}**, ${width} × ${height} pixels. ${clear} ${note}`;
  });
  return `Make a set of images for a simple side-scrolling browser game, like Flappy Bird.

The theme: ${themeOf(idea)}

Keep all of them in one consistent art style, with bold shapes and clear outlines, because they are shown small on a screen. Make each one a separate image at exactly the size given, and name each file exactly as shown, because the game reads the names to know where each picture goes.

${lines.join('\n')}

${BUNDLE}
`;
}

// What each sound is for, and how long it can be before it gets in the way.
const SOUND_NOTES = {
  launch: 'Plays once when a round starts. Under 1 second.',
  score: 'Plays every time the player gets past an obstacle, so it is heard a lot. Short and pleasant, under half a second.',
  crash: 'Plays once when the player crashes and the round ends. About 1 second.',
  thrust: 'Plays over and over while the player is steering, so it must be very short and not tiring to hear repeated. Under half a second.',
};

/** The prompt for a set of sound effects and a music loop, for the game `idea` describes. */
export function soundPrompt(idea = '') {
  const lines = SOUND_EVENTS.map(([event, lead]) =>
    `- \`${event}.mp3\` — ${SOUND_NOTES[event] ?? `${lead.replace(/, play$/, '')}.`}`);
  return `Make sound effects and a music loop for a simple side-scrolling browser game, like Flappy Bird.

The theme: ${themeOf(idea)}

Give each one as its own MP3 or WAV file, with no silence at the start, so it plays the instant it is triggered. Keep them in one consistent style. Name each file exactly as shown, because the game reads the names to know where each sound goes.

${lines.join('\n')}
- \`music.mp3\` — Background music that loops for as long as the game is played. 20 to 60 seconds long, and it must loop seamlessly, with the end flowing straight back into the start. Keep it in the background: no vocals, nothing too busy.

${BUNDLE}
`;
}
