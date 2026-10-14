/** User-supplied transcription. The original game image has NOT been supplied.
 * Geometry in tests is synthetic; these values must not be called an image OCR result. */
export const USER_REPORT_TROOPS = [
  { side: "left", troop: "shield", display: 11, fc: 9, count: 741805,
    composition: [["T11-FC9", 1]] },
  { side: "left", troop: "lancer", display: 10.3, fc: 8, count: 64035,
    composition: [["T10-FC8", .7], ["T11-FC8", .3]] },
  { side: "left", troop: "marksman", display: 11.4, fc: 9, count: 886378,
    composition: [["T11-FC9", .6], ["T12-FC9", .4]] },
  { side: "right", troop: "shield", display: 11.5, fc: 10, count: 4659053,
    composition: [["T11-FC10", .5], ["T12-FC10", .5]] },
  { side: "right", troop: "lancer", display: 11.4, fc: 10, count: 3616209,
    composition: [["T11-FC10", .6], ["T12-FC10", .4]] },
  { side: "right", troop: "marksman", display: 11.4, fc: 10, count: 3149491,
    composition: [["T11-FC10", .6], ["T12-FC10", .4]] },
] as const;
