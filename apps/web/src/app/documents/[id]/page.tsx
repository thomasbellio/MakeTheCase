import { notFound } from 'next/navigation';
import { documentIdSchema } from '@make-your-case/domain';
import { DocumentScreen } from '../../../client/views/document-screen';

/** `/documents/[id]`: watch a run, then explore its argument (AGENTS.md section 9.2). */
export default async function DocumentPage({ params }: PageProps<'/documents/[id]'>) {
  const parsed = documentIdSchema.safeParse((await params).id);
  if (!parsed.success) notFound();
  return <DocumentScreen documentId={parsed.data} />;
}
