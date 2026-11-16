import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Listing } from '../../shared/types';
import { Column, DataTable } from '../components/data_table';
import { useDb } from '../data_context';
import { formatAddress, formatPrice } from '../format';

export function ListingsPage(): JSX.Element {
  const { db } = useDb();
  const rows = useMemo(() => Object.values(db.listings), [db]);

  const address = (l: Listing) => {
    const p = db.properties[l.propertyId];
    return p ? formatAddress(p) : l.propertyId;
  };

  const columns: Column<Listing>[] = [
    { key: 'listedDate', header: 'Listed' },
    {
      key: 'property',
      header: 'Property',
      sortValue: address,
      render: (l) => <Link to={`/property/${encodeURIComponent(l.propertyId)}`}>{address(l)}</Link>,
    },
    { key: 'listingType', header: 'Type' },
    { key: 'event', header: 'Event' },
    { key: 'price', header: 'Price', align: 'right', render: (l) => formatPrice(l.price) },
    { key: 'bedrooms', header: 'Beds', align: 'right' },
    { key: 'bathrooms', header: 'Baths', align: 'right' },
    { key: 'floorAreaSqm', header: 'm²', align: 'right' },
    { key: 'images', header: 'Photos', align: 'right', sortValue: (l) => l.images.length, render: (l) => l.images.length || '' },
    { key: 'status', header: 'Status' },
    { key: 'agent', header: 'Agent' },
    { key: 'condition', header: 'Condition' },
  ];

  return (
    <section>
      <div className="toolbar">
        <h2>Listings ({rows.length})</h2>
      </div>
      <DataTable rows={rows} columns={columns} rowKey={(l) => l.id} initialSort={{ key: 'listedDate', dir: -1 }} empty="No listings yet - run yarn scrape:zoopla" />
    </section>
  );
}
