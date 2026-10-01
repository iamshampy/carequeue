'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function LegacyClinicRedirect() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();

  useEffect(() => {
    if (slug) {
      router.replace(`/${slug}`);
    }
  }, [slug, router]);

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#64748b' }}>
      Loading clinic page…
    </div>
  );
}
