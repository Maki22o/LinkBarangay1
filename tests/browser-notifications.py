"""Rendered app checks with intercepted Supabase HTTP; never a live-backend test.

Prerequisite: Python Playwright + Chromium already installed. No app dependency.
Run isolated Vite with:
 VITE_SUPABASE_URL=https://linkbarangay-test.supabase.co \
 VITE_SUPABASE_PUBLISHABLE_KEY=fixture-only-public-key PORT=18443 npm run dev
Then: python tests/browser-notifications.py
Override LINKBARANGAY_BROWSER_URL or CHROMIUM_EXECUTABLE when needed.
"""
import base64
import json
import os
import re
import time
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright

APP = os.environ.get('LINKBARANGAY_BROWSER_URL', 'http://127.0.0.1:18443')
HOST = 'linkbarangay-test.supabase.co'
USER = '10000000-0000-0000-0000-000000000001'
STAMP = '2026-11-14T10:00:00.123456+00:00'
PROFILE = {
    'id': USER, 'full_name': 'Notification Tester', 'email': 'resident@example.test',
    'mobile': '', 'address': '', 'role': 'resident', 'worker_function': None,
    'status': 'active', 'barangay_id': '20000000-0000-0000-0000-000000000001',
    'department_id': None, 'created_at': STAMP,
}


def notification(n):
    return {
        'id': f'00000000-0000-0000-0000-{n:012d}', 'user_id': USER,
        'title': f'Request update {n}', 'message': 'Your committed request was updated.',
        'request_id': None, 'event_type': 'request.status', 'destination_view': None,
        'entity_id': None, 'is_read': False, 'read_at': None, 'created_at': STAMP,
    }


def session():
    expiry = int(time.time()) + 3600
    encode = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
    token = '.'.join([encode({'alg': 'HS256', 'typ': 'JWT'}), encode({
        'sub': USER, 'role': 'authenticated', 'aud': 'authenticated', 'exp': expiry,
    }), 'fixture-signature'])
    return {'access_token': token, 'refresh_token': 'fixture-refresh', 'expires_at': expiry,
            'expires_in': 3600, 'token_type': 'bearer', 'user': {
                'id': USER, 'aud': 'authenticated', 'role': 'authenticated',
                'email': PROFILE['email'], 'app_metadata': {'provider': 'email'},
                'user_metadata': {}, 'created_at': STAMP,
            }}


class Fixture:
    def __init__(self, size):
        self.rows = [notification(i + 1) for i in range(size)]
        self.fail = False
        self.reads = 0
        self.lists = 0

    def handle(self, route):
        request = route.request
        url = urlparse(request.url)
        query = parse_qs(url.query)
        headers = {'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-type': 'application/json'}
        def reply(data, status=200, extra=None):
            route.fulfill(status=status, headers={**headers, **(extra or {})}, body=json.dumps(data))
        if request.method == 'OPTIONS':
            route.fulfill(status=204, headers={**headers,
                'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}, body='')
        elif url.path.endswith('/lb_profiles'):
            reply([PROFILE])
        elif url.path.endswith('/lb_notifications'):
            unread = sum(not row['is_read'] for row in self.rows)
            if self.fail:
                reply({'code': '42501', 'message': 'Simulated notification permission error'}, 403)
            elif request.method == 'HEAD':
                route.fulfill(status=200, headers={**headers, 'content-range': f'*/{unread}'}, body='')
            else:
                self.lists += 1
                rows = sorted(self.rows, key=lambda row: row['id'], reverse=True)
                cursor = re.search(r'id\.lt\.([0-9a-f-]{36})', query.get('or', [''])[0])
                if cursor:
                    rows = [row for row in rows if row['id'] < cursor.group(1)]
                reply(rows[:int(query.get('limit', ['51'])[0])])
        elif url.path.endswith('/rpc/app_mark_notifications_read'):
            payload = request.post_data_json
            assert payload['p_expected_user_id'] == USER
            target = payload.get('p_notification_id')
            affected = 0
            for row in self.rows:
                if (target is None or row['id'] == target) and not row['is_read']:
                    row['is_read'] = True
                    row['read_at'] = STAMP
                    affected += 1
            self.reads += 1
            reply(affected)
        elif url.path.endswith('/user'):
            reply(session()['user'])
        else:
            reply([], extra={'content-range': '*/0'})


def open_app(browser, size, mobile=False):
    fixture = Fixture(size)
    context = browser.new_context(viewport={'width': 390 if mobile else 1440, 'height': 844 if mobile else 1000})
    context.route(f'https://{HOST}/**', fixture.handle)
    # Prevent any network connection to an external Realtime service. HTTP
    # fixtures exercise rendered state; separate unit tests cover reconnection.
    context.route_web_socket(f'wss://{HOST}/**', lambda ws: None)
    value = json.dumps(session())
    context.add_init_script(f'localStorage.setItem("sb-linkbarangay-test-auth-token", {json.dumps(value)});')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(APP, wait_until='domcontentloaded')
    expect(page.locator('.notification-button')).to_be_visible(timeout=20000)
    return context, page, fixture, errors


def run():
    checks = 0
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE', '/usr/bin/chromium'),
                                             headless=True, args=['--no-sandbox'])
        for mobile in [False, True]:
            for count in [0, 1, 99, 100]:
                context, page, fixture, errors = open_app(browser, count, mobile)
                bell = page.locator('.notification-button')
                expect(bell).to_have_attribute('aria-label', f'Notifications ({count} unread)')
                badge = bell.locator('i')
                if count == 0:
                    expect(badge).to_have_count(0)
                else:
                    expect(badge).to_have_text('99+' if count > 99 else str(count))
                    expect(badge).to_be_visible()
                    box = badge.bounding_box()
                    assert box and box['x'] >= 0 and box['x'] + box['width'] <= page.viewport_size['width']
                if not mobile:
                    page.locator('.account-button').click()
                    if count:
                        expect(page.locator('.account-menu b')).to_have_text('99+' if count > 99 else str(count))
                    else:
                        expect(page.locator('.account-menu b')).to_have_count(0)
                else:
                    page.get_by_role('button', name='Open menu', exact=True).click()
                    sidebar_badge = page.locator('.sidebar nav button').filter(has=page.locator('span', has_text='Notifications')).locator('b')
                    if count:
                        expect(sidebar_badge).to_have_text('99+' if count > 99 else str(count))
                    else:
                        expect(sidebar_badge).to_have_count(0)
                assert not errors, errors
                checks += 1
                context.close()
                print(f'PASS badge desktop/mobile={mobile} unread={count}')

        context, page, fixture, errors = open_app(browser, 123)
        page.locator('.notification-button').click()
        expect(page.get_by_role('heading', name='Notifications', exact=True)).to_be_visible()
        expect(page.locator('article.notification-item')).to_have_count(50)
        assert fixture.reads == 0, 'opening the page must not mark notifications read'
        page.get_by_role('button', name='Load older notifications', exact=True).click()
        expect(page.locator('article.notification-item')).to_have_count(100)
        page.get_by_role('button', name='Load older notifications', exact=True).click()
        expect(page.locator('article.notification-item')).to_have_count(123)
        expect(page.get_by_role('button', name='Load older notifications', exact=True)).to_have_count(0)
        page.locator('.notification-read-action').first.click()
        expect(page.locator('.generic-page').get_by_text('122 unread', exact=True)).to_be_visible()
        expect(page.locator('article.notification-item.unread')).to_have_count(122)
        page.get_by_role('button', name='Mark all read', exact=True).click()
        expect(page.locator('.notification-button i')).to_have_count(0)
        expect(page.locator('article.notification-item.unread')).to_have_count(0)
        assert fixture.reads == 2
        page.reload(wait_until='domcontentloaded')
        expect(page.locator('.notification-button')).to_have_attribute('aria-label', 'Notifications (0 unread)')
        page.locator('.notification-button').click()
        expect(page.locator('article.notification-item')).to_have_count(50)
        expect(page.locator('article.notification-item.unread')).to_have_count(0)
        assert not errors, errors
        checks += 1
        context.close()
        print('PASS inbox pagination, committed read controls, no auto-read, reload persistence')

        context, page, fixture, errors = open_app(browser, 0, True)
        page.locator('.notification-button').click()
        expect(page.get_by_text('No notifications yet', exact=True)).to_be_visible()
        fixture.fail = True
        page.get_by_role('button', name='Refresh', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('Simulated notification permission error')
        fixture.fail = False
        page.get_by_role('button', name='Try again', exact=True).click()
        expect(page.get_by_role('alert')).to_have_count(0)
        expect(page.get_by_text('No notifications yet', exact=True)).to_be_visible()
        assert not errors, errors
        checks += 1
        context.close()
        print('PASS mobile empty, fetch error and retry states')
        browser.close()
    print(f'{checks} mocked HTTP browser scenarios passed. Live Supabase/Realtime not exercised.')


if __name__ == '__main__':
    run()
