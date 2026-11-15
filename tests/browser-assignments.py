"""Rendered reassignment regression; use the same fixture Vite server as browser-notifications.py."""
import importlib.util
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright

spec = importlib.util.spec_from_file_location('notification_fixture', Path(__file__).with_name('browser-notifications.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
DEPT = '20000000-0000-0000-0000-000000000002'
base.PROFILE.update(role='worker', worker_function='field', department_id=DEPT)

def job(number):
    return {
        'id': f'40000000-0000-0000-0000-{number:012d}',
        'request_id': '50000000-0000-0000-0000-000000000001', 'assigned_to': base.USER,
        'assigned_by': None, 'department_id': DEPT, 'status': 'pending',
        'decline_reason': '', 'schedule_at': None, 'deadline_at': None,
        'accepted_at': None, 'completed_at': None, 'notes': 'Assignment instructions',
        'created_at': f'2026-11-14T10:00:0{number}.000000+00:00', 'updated_at': base.STAMP,
        'request': {'id': '50000000-0000-0000-0000-000000000001', 'reference': 'LB-TEST-001',
                    'title': 'Current request', 'assigned_to': base.USER, 'status': 'verified',
                    'department_id': DEPT, 'priority': 'normal', 'location': 'Test location'},
    }

class AssignmentFixture(base.Fixture):
    def handle(self, route):
        parsed = urlparse(route.request.url)
        if parsed.path.endswith('/lb_assignments'):
            query = parse_qs(parsed.query)
            rows = [job(2), job(1)]
            if 'id' in query:
                rows = [row for row in rows if row['id'] == query['id'][0].removeprefix('eq.')]
            if query.get('select') == ['id']:
                rows = [{'id': row['id']} for row in rows[:1]]
            import json
            route.fulfill(status=200, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'}, body=json.dumps(rows))
        else:
            super().handle(route)

base.Fixture = AssignmentFixture
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=base.os.environ.get('CHROMIUM_EXECUTABLE', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    context, page, fixture, errors = base.open_app(browser, 0, False)
    expect(page.locator('.metric-card').filter(has_text='To accept').locator('strong')).to_have_text('1')
    page.get_by_role('button', name='All assigned jobs', exact=True).click()
    expect(page.locator('.job-list > button')).to_have_count(1)
    page.locator('.queue-tabs button').filter(has_text='All').click()
    expect(page.locator('.job-list > button')).to_have_count(2)
    expect(page.get_by_text('Previous assignment', exact=True)).to_be_visible()
    page.locator('.job-list > button').nth(1).click()
    expect(page.get_by_text('This assignment is kept for your history.', exact=False)).to_be_visible()
    expect(page.get_by_role('button', name='Accept assignment', exact=True)).to_have_count(0)
    page.get_by_role('button', name='Back to jobs', exact=True).click()
    expect(page.locator('.job-list > button')).to_have_count(1)
    page.locator('.job-list > button').click()
    expect(page.get_by_role('button', name='Accept assignment', exact=True)).to_be_visible()
    assert not errors, errors
    context.close()
    browser.close()
print('PASS rendered field workload, preserved reassignment history, disabled stale actions, and current job access')
