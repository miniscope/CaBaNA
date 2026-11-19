// "1 frame", "2 frames": a count with its noun in the right number.

/** `n` and `word`, with an "s" unless n is 1; pass `many` for irregular plurals ("gap"/"gaps" need none). */
export const plural = (n: number, word: string, many = `${word}s`): string =>
  `${n} ${n === 1 ? word : many}`;
