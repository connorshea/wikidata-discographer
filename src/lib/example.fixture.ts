// A filled-in album the tests use as a fixture.
import type { State, Track } from "./plan.ts";
import { EMPTY } from "./state.ts";

/** A track without imported identifiers, its length written like "4:12". */
export const track = (
  n: number,
  title: string,
  length: string | null = null,
  artists = ["Carly Rae Jepsen"],
): Track => {
  const [m, s] = (length ?? "").split(":").map(Number);
  return { n, title, artists, seconds: length === null ? null : m * 60 + s, mb: null };
};

const tracks = (titles: [string, string][]) => titles.map(([t, l], i) => track(i + 1, t, l));

export const EXAMPLE: State = {
  start: "existing",
  settings: { ...EMPTY.settings, date: "2026-09-18", p407: "Q1860" },
  album: {
    ...EMPTY.album,
    qid: "Q140316456",
    title: "Day and Night",
    artists: ["Carly Rae Jepsen"],
  },
  artists: { "Carly Rae Jepsen": "Q52583" },
  places: {},
  discs: [
    {
      part: "Q61629664",
      comp: { "1": "Q140882264" },
      track: {},
      tracks: tracks([
        ["After All", "4:12"],
        ["Habits of Creatures", "2:57"],
        ["Versailles", "3:14"],
        ["On Wires", "3:22"],
        ["Blue Skies", "2:29"],
        ["Burning Heart", "3:30"],
        ["Wild Child", "3:49"],
        ["Good Fine Alright", "4:09"],
        ["Something Tragic", "2:57"],
        ["Soft", "3:03"],
        ["Lonely Side of the Bed", "3:30"],
        ["Just a Little Walk on the Moon", "3:48"],
      ]),
    },
    {
      part: "Q61629680",
      comp: {},
      track: {},
      tracks: tracks([
        ["Never Let a Good Thing Die", "5:19"],
        ["Amalfi Coast", "2:59"],
        ["Patience Power Passion", "3:29"],
        ["Don’t Leave Me on the Dance Floor", "3:12"],
        ["Motivation", "3:53"],
        ["You Don’t Know How It Feels", "3:14"],
        ["Near or Far", "3:17"],
        ["Diver", "3:06"],
        ["Hold Me to the Light", "3:56"],
        ["That’s Just Me", "3:42"],
        ["No Labels, I Love You", "3:40"],
        ["Super Sage", "4:01"],
      ]),
    },
  ],
};
