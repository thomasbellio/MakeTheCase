import { NewAnalysisScreen } from '../client/views/new-analysis-screen';
import { serverEnv } from '../server/env';

// Reads configuration at request time, not at build.
export const dynamic = 'force-dynamic';

/** `/`: submit a text for analysis (AGENTS.md section 9.2). */
export default function Home() {
  return <NewAnalysisScreen maxDocumentChars={serverEnv().MAX_DOCUMENT_CHARS} />;
}
