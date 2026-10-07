import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Page } from '@/components/layout/AppShell';
import { PhotoInput } from '@/components/images';
import { Button } from '@/components/ui/button';
import { DateInput, Field, Input, MoneyInput, NumberInput, Select, Switch, Textarea } from '@/components/ui/form';
import { Card, CardBody, CardHeader, PageLoader } from '@/components/ui/misc';
import { api } from '@/lib/api';
import type { Vehicle, VehicleDetail } from '@/lib/types';
import { errorMessage } from '@/lib/utils';
import { CAR_MAKES, findCarMake, findCarModel } from '@shared/carModels';
import { FUEL_LABEL, FUEL_TYPES, TRANSMISSIONS, TRANSMISSION_LABEL } from '@shared/constants';

type Form = Partial<Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt' | 'archivedAt' | 'plateKey'>>;

const EMPTY: Form = { plate: '', make: '', model: '', odo: 0, active: true, ownerType: 'own', priceDay: 0, priceHour: 0, kmLimitDay: 300, overKmFee: 0, overHourFee: 0, depositAmount: 0, transmission: 'AT', fuel: 'gasoline', seats: 5 };

function Group({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
      </CardBody>
    </Card>
  );
}

const OTHER = '__other';

/** Hãng → dòng xe chọn từ danh mục (VinFast đầu tiên); "Khác" để tự nhập. */
function MakeModelFields({ make, model, onMake, onModel, onElectric }: { make: string; model: string; onMake: (v: string) => void; onModel: (v: string) => void; onElectric: () => void }) {
  const [makeMode, setMakeMode] = useState<'list' | 'other'>('list');
  const [modelMode, setModelMode] = useState<'list' | 'other'>('list');
  const known = findCarMake(make);
  const makeOther = makeMode === 'other' || (!!make && !known);
  const modelOther = !known || makeOther || modelMode === 'other' || (!!model && !findCarModel(known, model));
  const back = (onClick: () => void) => (
    <button type="button" onClick={onClick} className="mt-1 text-xs text-brand hover:underline">
      Chọn từ danh sách
    </button>
  );
  return (
    <>
      <Field label="Hãng">
        {makeOther ? (
          <>
            <Input value={make} onChange={(e) => onMake(e.target.value)} placeholder="Tên hãng" autoFocus={makeMode === 'other'} />
            {back(() => {
              setMakeMode('list');
              onMake('');
              onModel('');
            })}
          </>
        ) : (
          <Select
            value={known?.name ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              if (v === OTHER) {
                setMakeMode('other');
                onMake('');
              } else {
                onMake(v);
                if (!findCarModel(findCarMake(v), model)) onModel('');
              }
              setModelMode('list');
            }}
          >
            <option value="">— Chọn hãng —</option>
            {CAR_MAKES.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
            <option value={OTHER}>Khác (tự nhập)</option>
          </Select>
        )}
      </Field>
      <Field label="Dòng xe">
        {modelOther ? (
          <>
            <Input value={model} onChange={(e) => onModel(e.target.value)} placeholder={known ? 'Tên dòng xe' : 'Vios 1.5G'} autoFocus={modelMode === 'other'} />
            {known && !makeOther && back(() => {
              setModelMode('list');
              onModel('');
            })}
          </>
        ) : (
          <Select
            value={findCarModel(known, model) ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              if (v === OTHER) {
                setModelMode('other');
                onModel('');
                return;
              }
              onModel(v);
              if (known?.electric?.includes(v)) onElectric();
            }}
          >
            <option value="">— Chọn dòng xe —</option>
            {known?.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value={OTHER}>Khác (tự nhập)</option>
          </Select>
        )}
      </Field>
    </>
  );
}

export default function VehicleEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['vehicle', id], queryFn: () => api.get<VehicleDetail>(`/api/vehicles/${id}`), enabled: !!id });
  const [f, setF] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!data) return;
    // Khớp tên đã lưu với danh mục ("Vinfast" → "VinFast", "VF3" → "VF 3").
    const mk = findCarMake(data.vehicle.make);
    setF({ ...data.vehicle, make: mk?.name ?? data.vehicle.make, model: findCarModel(mk, data.vehicle.model) ?? data.vehicle.model });
  }, [data]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));
  const text = (k: keyof Form) => ({ value: (f[k] as string | null | undefined) ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value as never) });

  const save = async () => {
    if (!f.plate?.trim()) return toast.error('Nhập biển số');
    if (!f.priceDay) return toast.error('Nhập giá thuê ngày');
    setSaving(true);
    try {
      const v = id ? await api.patch<Vehicle>(`/api/vehicles/${id}`, f) : await api.post<Vehicle>('/api/vehicles', f);
      void qc.invalidateQueries({ queryKey: ['vehicles'] });
      void qc.invalidateQueries({ queryKey: ['vehicle', String(v.id)] });
      toast.success(id ? 'Đã lưu xe' : `Đã thêm xe ${v.plate}`);
      navigate(`/vehicles/${v.id}`, { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (id && isLoading) return <PageLoader />;
  return (
    <Page title={id ? `Sửa xe ${data?.vehicle.plate ?? ''}` : 'Thêm xe'} back width="narrow">
      <div className="space-y-4">
        <Group title="Thông tin xe">
          <Field label="Biển số" required>
            <Input {...text('plate')} placeholder="51K-123.45" autoCapitalize="characters" />
          </Field>
          <MakeModelFields make={f.make ?? ''} model={f.model ?? ''} onMake={(v) => set('make', v)} onModel={(v) => set('model', v)} onElectric={() => set('fuel', 'electric')} />
          <Field label="Năm sản xuất">
            <NumberInput value={f.year} onChange={(v) => set('year', v)} placeholder="2022" plain maxDigits={4} />
          </Field>
          <Field label="Màu">
            <Input {...text('color')} />
          </Field>
          <Field label="Số chỗ">
            <NumberInput value={f.seats} onChange={(v) => set('seats', v)} />
          </Field>
          <Field label="Hộp số">
            <Select value={f.transmission ?? ''} onChange={(e) => set('transmission', (e.target.value || null) as never)}>
              {TRANSMISSIONS.map((t) => (
                <option key={t} value={t}>
                  {TRANSMISSION_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Nhiên liệu">
            <Select value={f.fuel ?? ''} onChange={(e) => set('fuel', (e.target.value || null) as never)}>
              {FUEL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {FUEL_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="ODO hiện tại">
            <NumberInput value={f.odo} onChange={(v) => set('odo', v ?? 0)} suffix="km" />
          </Field>
          <Field label="Số khung">
            <Input {...text('vin')} autoCapitalize="characters" />
          </Field>
          <Field label="Số máy">
            <Input {...text('engineNo')} autoCapitalize="characters" />
          </Field>
          <div className="flex items-end pb-2">
            <Switch checked={f.active ?? true} onChange={(v) => set('active', v)} label="Đang hoạt động" />
          </div>
        </Group>

        <Group title="Bảng giá" description="Giá lúc đặt được chốt vào lượt thuê. Có giá tháng thì app tự chọn cách tính rẻ hơn cho khách (theo ngày hoặc theo tháng).">
          <Field label="Giá ngày (24h)" required>
            <MoneyInput value={f.priceDay} onChange={(v) => set('priceDay', v ?? 0)} />
          </Field>
          <Field label="Giá ngày cuối tuần" hint="Để trống = như ngày thường">
            <MoneyInput value={f.priceWeekendDay} onChange={(v) => set('priceWeekendDay', v)} />
          </Field>
          <Field label="Giá giờ lẻ">
            <MoneyInput value={f.priceHour} onChange={(v) => set('priceHour', v ?? 0)} />
          </Field>
          <Field label="Giới hạn km/ngày" hint="0 = không giới hạn">
            <NumberInput value={f.kmLimitDay} onChange={(v) => set('kmLimitDay', v ?? 0)} suffix="km" />
          </Field>
          <Field label="Phí vượt km">
            <MoneyInput value={f.overKmFee} onChange={(v) => set('overKmFee', v ?? 0)} />
          </Field>
          <Field label="Phí quá giờ (mỗi giờ)">
            <MoneyInput value={f.overHourFee} onChange={(v) => set('overHourFee', v ?? 0)} />
          </Field>
          <Field label="Tiền cọc mặc định">
            <MoneyInput value={f.depositAmount} onChange={(v) => set('depositAmount', v ?? 0)} />
          </Field>
          <Field label="Giá thuê tháng" hint="Để trống nếu không nhận thuê tháng">
            <MoneyInput value={f.priceMonth} onChange={(v) => set('priceMonth', v)} />
          </Field>
          <Field label="Giới hạn km/tháng" hint={f.kmLimitDay ? `Để trống = ${(f.kmLimitDay * 30).toLocaleString('vi-VN')} km (30 × km/ngày)` : 'Để trống = không giới hạn'}>
            <NumberInput value={f.kmLimitMonth} onChange={(v) => set('kmLimitMonth', v)} suffix="km" />
          </Field>
        </Group>

        <Group title="Giấy tờ & hạn" description="App nhắc trước 30 ngày khi sắp hết hạn">
          <Field label="Hạn đăng kiểm">
            <DateInput value={f.inspectionExpiry} onChange={(v) => set('inspectionExpiry', v)} />
          </Field>
          <Field label="Hạn bảo hiểm TNDS">
            <DateInput value={f.insuranceTndsExpiry} onChange={(v) => set('insuranceTndsExpiry', v)} />
          </Field>
          <Field label="Hạn bảo hiểm thân vỏ">
            <DateInput value={f.insuranceBodyExpiry} onChange={(v) => set('insuranceBodyExpiry', v)} />
          </Field>
          <Field label="Hạn phí đường bộ">
            <DateInput value={f.roadFeeExpiry} onChange={(v) => set('roadFeeExpiry', v)} />
          </Field>
          <Field label="Bảo dưỡng tiếp theo (km)">
            <NumberInput value={f.nextServiceOdo} onChange={(v) => set('nextServiceOdo', v)} suffix="km" />
          </Field>
          <Field label="Bảo dưỡng tiếp theo (ngày)">
            <DateInput value={f.nextServiceDate} onChange={(v) => set('nextServiceDate', v)} />
          </Field>
        </Group>

        <Group title="Chủ xe">
          <Field label="Loại">
            <Select value={f.ownerType ?? 'own'} onChange={(e) => set('ownerType', e.target.value as 'own' | 'consigned')}>
              <option value="own">Xe nhà</option>
              <option value="consigned">Xe ký gửi</option>
            </Select>
          </Field>
          {f.ownerType === 'consigned' && (
            <>
              <Field label="Tên chủ xe">
                <Input {...text('ownerName')} />
              </Field>
              <Field label="SĐT chủ xe">
                <Input {...text('ownerPhone')} type="tel" />
              </Field>
              <Field label="Chủ xe hưởng (%)">
                <NumberInput value={f.ownerSharePct} onChange={(v) => set('ownerSharePct', v)} suffix="%" />
              </Field>
            </>
          )}
        </Group>

        <Card>
          <CardHeader title="Ảnh & ghi chú" />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:max-w-md">
              <PhotoInput kind="vehicle_photo" label="Ảnh xe" value={f.photoFileId} onChange={(v) => set('photoFileId', v)} />
              <PhotoInput kind="vehicle_doc" label="Giấy đăng ký xe" value={f.registrationFileId} onChange={(v) => set('registrationFileId', v)} />
            </div>
            <Field label="Ghi chú">
              <Textarea {...text('notes')} rows={3} />
            </Field>
          </CardBody>
        </Card>

        <div className="flex justify-end">
          <Button size="lg" onClick={save} loading={saving} className="w-full sm:w-auto">
            {id ? 'Lưu thay đổi' : 'Thêm xe'}
          </Button>
        </div>
      </div>
    </Page>
  );
}
