import { normalizeWhitespace } from '../lib/utils.mjs';

const SOURCE_ID = 'nyc_dob';
const API_ENDPOINT = 'https://data.cityofnewyork.us/resource/rbx6-tga4.json';
const BOROUGHS = ['MANHATTAN', 'BROOKLYN', 'QUEENS', 'BRONX', 'STATEN ISLAND'];

function buildAddress(record) {
  return normalizeWhitespace([record.house_no, record.street_name, record.borough, 'NY', record.zip_code].filter(Boolean).join(' '));
}

export default {
  id: SOURCE_ID,
  name: 'NYC Department of Buildings',
  region: 'NYC',

  async fetchPermits(since, options = {}) {
    const limit = options.limit || 150;
    const sinceIso = `${since}T00:00:00`;
    const boroughFilters = BOROUGHS.map((borough) => `borough='${borough}'`).join(' OR ');
    const where = [
      `issued_date >= '${sinceIso}'`,
      `permit_status='Permit Issued'`,
      `work_type='General Construction'`,
      `(${boroughFilters})`,
    ].join(' AND ');

    const url = `${API_ENDPOINT}?$where=${encodeURIComponent(where)}&$order=issued_date DESC&$limit=${limit}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`NYC DOB fetch failed: ${response.status}`);
    }

    const rows = await response.json();

    return rows.map((record) => ({
      permit_number: record.job_filing_number || record.permit_number || record.work_permit || '',
      source: SOURCE_ID,
      address: buildAddress(record),
      borough_or_municipality: normalizeWhitespace(record.borough || ''),
      state: 'NY',
      work_description: normalizeWhitespace(record.job_description || ''),
      filing_date: String(record.issued_date || record.approved_date || '').split('T')[0] || null,
      permit_type: normalizeWhitespace(record.work_type || ''),
      applicant_name: normalizeWhitespace(
        record.applicant_business_name
          || [record.applicant_first_name, record.applicant_middle_name, record.applicant_last_name].filter(Boolean).join(' '),
      ),
      owner_name: normalizeWhitespace(record.owner_business_name || record.owner_name || ''),
      raw_data: record,
    })).filter((record) => Boolean(record.permit_number));
  },
};
