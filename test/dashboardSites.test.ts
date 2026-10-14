import test from 'node:test';
import assert from 'node:assert/strict';
import { DASHBOARD_SITES, dashboardSiteId } from '../src/constants/sites.ts';
test('dashboard has exactly the eight approved names with Jayant aliases combined', () => {
 assert.deepEqual(DASHBOARD_SITES.map(s=>s.name), ['Sasti OC','Gauri Pauni OC (2nd)','Dhoptala OC (2nd)','Majri OC','Dudhichua OC','Dudhichua East OC','Lalpeth OC','Jayant OC']);
 assert.equal(DASHBOARD_SITES.filter(s=>s.location==='WCL').length,5);
 assert.equal(DASHBOARD_SITES.filter(s=>s.location==='NCL').length,3);
 assert.equal(dashboardSiteId('site-ncl-jayant-2'),dashboardSiteId('site-ncl-jayant-1'));
 assert.equal(dashboardSiteId('site-ncl-dch-east'),'site-ncl-dch-east');
 assert.equal(dashboardSiteId(null),null);
});
