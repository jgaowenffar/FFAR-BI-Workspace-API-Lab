export function sampleResult(name, stage) {
  return {
    title: `${name} — synthetic ${stage.label}`,
    summary:
      "Synthetic workflow fixture. No public research or API call was performed.",
    sections: stage.sections.map((key) => ({
      key,
      coverage: "not_found",
      facts: [
        {
          label: "Storage / rendering test",
          detail:
            "Synthetic data only. No assertion about the named organization.",
          source_url: null,
          date: null,
        },
      ],
    })),
    financials: [],
    questions: [],
    gaps: [
      "Synthetic fixture cannot establish research quality, coverage, latency or live cost.",
    ],
  };
}
