import type { QualifyingDoc } from "@/data/types";
import { Heatmap } from "./Heatmap";
import { pct, probNoun, useRace } from "./context";

export function QualifyingView({ doc }: { doc: QualifyingDoc }) {
  const { drivers } = useRace();
  const noun = probNoun(doc.model.calibrated);
  const rows = [...doc.drivers].sort(
    (a, b) => a.expected_position - b.expected_position,
  );
  const pole = [...doc.drivers].sort((a, b) => b.p_pole - a.p_pole)[0];
  return (
    <div className="space-y-5">
      {pole && (
        <div>
          <p className="label-caps mb-1">Pole {noun} · top</p>
          <p className="font-display text-4xl font-semibold leading-none tnum">
            {drivers.get(pole.driver_id)?.code ?? pole.driver_id}{" "}
            <span className="text-primary">{pct(pole.p_pole)}</span>
          </p>
        </div>
      )}
      <Heatmap
        compact
        noun={noun}
        verb="qualifies"
        rows={rows.map((r) => ({
          driver_id: r.driver_id,
          probs: r.position_probs,
          bars: [
            { label: "Pole", value: r.p_pole },
            { label: "Top 10", value: r.p_top10 },
          ],
        }))}
      />
    </div>
  );
}
