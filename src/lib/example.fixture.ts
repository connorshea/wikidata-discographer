// A filled-in album the tests use as a fixture.
import type { State } from "./plan.ts";
import { EMPTY } from "./state.ts";

export const EXAMPLE: State = {
  settings: { ...EMPTY.settings, date: "2026-09-18", p407: "Q1860" },
  album: { ...EMPTY.album, qid: "Q140316456", title: "Day and Night", artists: "Carly Rae Jepsen" },
  artists: { "Carly Rae Jepsen": "Q52583" },
  discs: [
    {
      part: "Q61629664",
      comp: { "1": "Q140882264" },
      track: {},
      single: {},
      mb: {},
      text: `1. After All - Carly Rae Jepsen (04:12)
2. Habits of Creatures - Carly Rae Jepsen (02:57)
3. Versailles - Carly Rae Jepsen (03:14)
4. On Wires - Carly Rae Jepsen (03:22)
5. Blue Skies - Carly Rae Jepsen (02:29)
6. Burning Heart - Carly Rae Jepsen (03:30)
7. Wild Child - Carly Rae Jepsen (03:49)
8. Good Fine Alright - Carly Rae Jepsen (04:09)
9. Something Tragic - Carly Rae Jepsen (02:57)
10. Soft - Carly Rae Jepsen (03:03)
11. Lonely Side of the Bed - Carly Rae Jepsen (03:30)
12. Just a Little Walk on the Moon - Carly Rae Jepsen (03:48)`,
    },
    {
      part: "Q61629680",
      comp: {},
      track: {},
      single: {},
      mb: {},
      text: `1. Never Let a Good Thing Die - Carly Rae Jepsen (05:19)
2. Amalfi Coast - Carly Rae Jepsen (02:59)
3. Patience Power Passion - Carly Rae Jepsen (03:29)
4. Don’t Leave Me on the Dance Floor - Carly Rae Jepsen (03:12)
5. Motivation - Carly Rae Jepsen (03:53)
6. You Don’t Know How It Feels - Carly Rae Jepsen (03:14)
7. Near or Far - Carly Rae Jepsen (03:17)
8. Diver - Carly Rae Jepsen (03:06)
9. Hold Me to the Light - Carly Rae Jepsen (03:56)
10. That’s Just Me - Carly Rae Jepsen (03:42)
11. No Labels, I Love You - Carly Rae Jepsen (03:40)
12. Super Sage - Carly Rae Jepsen (04:01)`,
    },
  ],
};
