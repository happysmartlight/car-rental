import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, FileText, Star, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { Badge, Card, CardBody, CardHeader, Notice, PageLoader } from '@/components/ui/misc';
import { api, fileUrl } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import type { ContractTemplate } from '@/lib/types';
import { errorMessage } from '@/lib/utils';
import { TEMPLATE_KINDS, TEMPLATE_KIND_LABEL, type TemplateKind } from '@shared/constants';
import { fmtDate } from '@shared/time';

const BUILTIN_FILES = ['hop-dong-thue-xe.docx', 'bien-ban-giao-xe.docx', 'bien-ban-nhan-xe.docx'];

export function SettingsTemplates() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['templates'], queryFn: () => api.get<ContractTemplate[]>('/api/templates') });
  const { data: fields } = useQuery({ queryKey: ['template-fields'], queryFn: () => api.get<{ group: string; fields: { key: string; label: string }[] }[]>('/api/templates/fields') });
  const [upload, setUpload] = useState<{ templateId?: number; name: string; kind: TemplateKind } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const patch = useAction(({ id, body }: { id: number; body: Partial<ContractTemplate> }) => api.patch(`/api/templates/${id}`, body), { invalidate: [['templates']], success: 'Đã cập nhật' });

  const doUpload = async () => {
    if (!file || !upload) return;
    setBusy(true);
    try {
      const form = new FormData();
      if (upload.templateId) form.append('templateId', String(upload.templateId));
      form.append('name', upload.name);
      form.append('kind', upload.kind);
      form.append('file', file);
      await api.form('/api/templates', form);
      toast.success(upload.templateId ? 'Đã lên phiên bản mới của mẫu' : 'Đã thêm mẫu');
      setUpload(null);
      setFile(null);
      void qc.invalidateQueries({ queryKey: ['templates'] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (isLoading || !data) return <PageLoader />;
  return (
    <div className="space-y-4">
      <Notice tone="blue" icon={FileText}>
        Mẫu là file Word (.docx). Tải mẫu về, sửa nội dung bằng Word, giữ nguyên các biến trong ngoặc nhọn như <code className="font-mono">{'{khach.ho_ten}'}</code>, rồi tải lên lại. Hợp đồng đã in trước đó không bị thay đổi.
      </Notice>
      <Card>
        <CardHeader title="Mẫu đang có" action={<Button size="sm" onClick={() => setUpload({ name: '', kind: 'contract' })}><Upload /> Thêm mẫu</Button>} />
        <ul className="divide-y divide-border">
          {data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 md:px-5">
              <FileText className="size-5 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {t.name}
                  {t.isDefault && <Badge tone="blue">Mặc định</Badge>}
                  {!t.active && <Badge>Tắt</Badge>}
                </p>
                <p className="text-xs text-muted">
                  {TEMPLATE_KIND_LABEL[t.kind]} · phiên bản {t.version} · cập nhật {fmtDate(t.updatedAt)}
                  {t.builtin && (/-v\d+$/.test(t.builtin) ? ' · mẫu dựng sẵn, tự cập nhật theo app' : ' · dựng sẵn, đã sửa')}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <a href={fileUrl(t.fileId, { download: true })} className="inline-flex h-8 items-center gap-1 rounded-lg bg-surface-2 px-2.5 text-xs font-medium hover:bg-surface-3">
                  <Download className="size-3.5" /> Tải về
                </a>
                <Button size="sm" variant="secondary" onClick={() => setUpload({ templateId: t.id, name: t.name, kind: t.kind })}>
                  <Upload /> Thay file
                </Button>
                {!t.isDefault && (
                  <Button size="sm" variant="ghost" onClick={() => patch.mutate({ id: t.id, body: { isDefault: true } })}>
                    <Star /> Đặt mặc định
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => patch.mutate({ id: t.id, body: { active: !t.active } })}>
                  {t.active ? 'Tắt' : 'Bật'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <CardBody className="flex flex-wrap gap-2 border-t border-border pt-4">
          <span className="text-sm text-muted">Mẫu gốc của app:</span>
          {BUILTIN_FILES.map((f) => (
            <a key={f} href={`/api/templates/builtin/${f}`} className="text-sm text-brand hover:underline">
              {f}
            </a>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Danh sách biến" description="Bấm để chép, dán vào Word" />
        <CardBody className="space-y-5">
          {fields?.map((g) => (
            <div key={g.group}>
              <p className="mb-2 text-sm font-semibold">{g.group}</p>
              <div className="grid gap-1 sm:grid-cols-2">
                {g.fields.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => {
                      void navigator.clipboard?.writeText(`{${f.key}}`);
                      toast.success(`Đã chép {${f.key}}`);
                    }}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                  >
                    <code className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">{`{${f.key}}`}</code>
                    <span className="truncate text-muted">{f.label}</span>
                    <Copy className="ml-auto size-3.5 shrink-0 text-subtle" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      <Dialog
        open={!!upload}
        onOpenChange={(o) => !o && setUpload(null)}
        title={upload?.templateId ? `Thay file cho "${upload.name}"` : 'Thêm mẫu mới'}
        description={upload?.templateId ? 'Phiên bản mẫu tăng lên 1. Văn bản in trước đó giữ nguyên.' : undefined}
        footer={<Button onClick={doUpload} loading={busy} disabled={!file}>Tải lên</Button>}
      >
        {upload && (
          <div className="space-y-4">
            {!upload.templateId && (
              <>
                <Field label="Tên mẫu">
                  <Input value={upload.name} onChange={(e) => setUpload({ ...upload, name: e.target.value })} placeholder="Hợp đồng thuê xe dài hạn" />
                </Field>
                <Field label="Loại">
                  <Select value={upload.kind} onChange={(e) => setUpload({ ...upload, kind: e.target.value as TemplateKind })}>
                    {TEMPLATE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {TEMPLATE_KIND_LABEL[k]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            )}
            <input ref={fileRef} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
              <Upload /> {file ? file.name : 'Chọn file .docx'}
            </Button>
            <p className="text-xs text-muted">App kiểm tra cú pháp biến ngay khi tải lên. Nếu Word tách một biến thành nhiều đoạn định dạng khác nhau, hãy gõ lại biến đó liền một lần.</p>
          </div>
        )}
      </Dialog>
    </div>
  );
}
