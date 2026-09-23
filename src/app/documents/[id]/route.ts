import { NextResponse, type NextRequest } from "next/server";

import { DOCUMENTS_BUCKET } from "@/lib/supabase/buckets";
import { createClient } from "@/lib/supabase/server";
import { recordId } from "@/lib/validation";

// Opens a document through a one-minute signed link. Row level security on
// documents and storage decides whether this user may see it at all.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!recordId.safeParse(id).success) return new NextResponse("Not found", { status: 404 });

  const supabase = await createClient();
  const { data: doc } = await supabase.from("documents").select("storage_path, file_name").eq("id", id).maybeSingle();
  if (!doc) return new NextResponse("Not found", { status: 404 });

  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(doc.storage_path, 60, { download: doc.file_name });
  if (error || !data) return new NextResponse("Not found", { status: 404 });

  return NextResponse.redirect(data.signedUrl);
}
