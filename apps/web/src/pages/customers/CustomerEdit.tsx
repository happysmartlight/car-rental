import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Page } from '@/components/layout/AppShell';
import { PageLoader } from '@/components/ui/misc';
import { api } from '@/lib/api';
import type { CustomerDetail } from '@/lib/types';
import { CustomerForm } from './CustomerForm';

export default function CustomerEdit() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api.get<CustomerDetail>(`/api/customers/${id}`),
    enabled: !!id,
  });
  if (id && isLoading) return <PageLoader />;
  return (
    <Page title={id ? `Sửa: ${data?.customer.fullName ?? ''}` : 'Thêm khách hàng'} back width="narrow">
      <CustomerForm
        initial={data?.customer}
        autoScan={params.get('scan') === '1'}
        onSaved={(c) => {
          void qc.invalidateQueries({ queryKey: ['customers'] });
          void qc.invalidateQueries({ queryKey: ['customer', String(c.id)] });
          navigate(params.get('next') === 'rental' ? `/rentals/new?customerId=${c.id}` : `/customers/${c.id}`, { replace: true });
        }}
      />
    </Page>
  );
}
