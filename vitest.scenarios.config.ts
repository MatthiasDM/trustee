import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";

// De scenario's delen één testomgeving en bouwen op elkaar voort (04 leest een document dat 03 aanmaakt).
// De standaardvolgorde van vitest zet eerder gefaalde en trage bestanden vooraan, waardoor één fout de volgorde omgooit
// en zichzelf in stand houdt. Daarom altijd op bestandsnaam.
class OpNaam extends BaseSequencer {
  async sort(files: TestSpecification[]) { return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId)); }
}

export default defineConfig({ test: { include: ["tests/scenarios/**/*.test.ts"], environment: "node", testTimeout: 30000, hookTimeout: 60000, fileParallelism: false, sequence: { concurrent: false, sequencer: OpNaam } } });
