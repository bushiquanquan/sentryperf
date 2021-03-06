from __future__ import absolute_import

from datetime import datetime, timedelta

from sentry.testutils import APITestCase, SnubaTestCase
from django.core.urlresolvers import reverse


class OrganizationDiscoverQueryTest(APITestCase, SnubaTestCase):
    def setUp(self):
        super(OrganizationDiscoverQueryTest, self).setUp()

        self.now = datetime.now()
        one_second_ago = self.now - timedelta(seconds=1)

        self.login_as(user=self.user, superuser=False)

        self.org = self.create_organization(owner=self.user, name='foo')

        self.project = self.create_project(
            name='bar',
            organization=self.org,
        )

        self.other_project = self.create_project(name='other')

        self.group = self.create_group(project=self.project, short_id=20)

        self.event = self.create_event(
            group=self.group,
            platform="python",
            datetime=one_second_ago,
            tags={'environment': 'production', 'sentry:release': 'foo'},
            data={
                'message': 'message!',
                'exception': {
                    'values': [
                        {
                            'type': 'ValidationError',
                            'value': 'Bad request',
                            'mechanism': {
                                'type': '1',
                                'value': '1',
                            },
                            'stacktrace': {
                                'frames': [
                                    {
                                        'function': '?',
                                        'filename': 'http://localhost:1337/error.js',
                                        'lineno': 29,
                                        'colno': 3,
                                        'in_app': True
                                    },
                                ]
                            },
                        }
                    ]
                }
            },
        )

    def test(self):
        with self.feature('organizations:discover'):
            url = reverse('sentry-api-0-organization-discover-query', args=[self.org.slug])
            response = self.client.post(url, {
                'projects': [self.project.id],
                'fields': ['message', 'platform.name'],
                'start': (datetime.now() - timedelta(seconds=10)).strftime('%Y-%m-%dT%H:%M:%S'),
                'end': (datetime.now()).strftime('%Y-%m-%dT%H:%M:%S'),
                'orderby': '-timestamp',
                'range': None,
            })

        assert response.status_code == 200, response.content
        assert len(response.data['data']) == 1
        assert response.data['data'][0]['message'] == 'message!'
        assert response.data['data'][0]['platform.name'] == 'python'

    def test_relative_dates(self):
        with self.feature('organizations:discover'):
            url = reverse('sentry-api-0-organization-discover-query', args=[self.org.slug])
            response = self.client.post(url, {
                'projects': [self.project.id],
                'fields': ['message', 'platform.name'],
                'range': '1d',
                'orderby': '-timestamp',
                'start': None,
                'end': None,
            })

        assert response.status_code == 200, response.content
        assert len(response.data['data']) == 1
        assert response.data['data'][0]['message'] == 'message!'
        assert response.data['data'][0]['platform.name'] == 'python'

    def test_invalid_date_request(self):
        with self.feature('organizations:discover'):
            url = reverse('sentry-api-0-organization-discover-query', args=[self.org.slug])
            response = self.client.post(url, {
                'projects': [self.project.id],
                'fields': ['message', 'platform'],
                'range': '1d',
                'start': (datetime.now() - timedelta(seconds=10)).strftime('%Y-%m-%dT%H:%M:%S'),
                'end': (datetime.now()).strftime('%Y-%m-%dT%H:%M:%S'),
                'orderby': '-timestamp',
            })

        assert response.status_code == 400, response.content

        with self.feature('organizations:discover'):
            url = reverse('sentry-api-0-organization-discover-query', args=[self.org.slug])
            response = self.client.post(url, {
                'projects': [self.project.id],
                'fields': ['message', 'platform'],
                'statsPeriodStart': '7d',
                'statsPeriodEnd': '1d',
                'start': (datetime.now() - timedelta(seconds=10)).strftime('%Y-%m-%dT%H:%M:%S'),
                'end': (datetime.now()).strftime('%Y-%m-%dT%H:%M:%S'),
                'orderby': '-timestamp',
            })

        assert response.status_code == 400, response.content

    def test_conditional_fields(self):
        with self.feature('organizations:discover'):
            one_second_ago = self.now - timedelta(seconds=1)
            self.create_event(
                group=self.group,
                platform="javascript",
                datetime=one_second_ago,
                tags={'environment': 'production', 'sentry:release': 'bar'},
                data={
                },
            )

            self.create_event(
                group=self.group,
                platform="javascript",
                datetime=one_second_ago,
                tags={'environment': 'production', 'sentry:release': 'baz'},
                data={
                },
            )

            url = reverse('sentry-api-0-organization-discover-query', args=[self.org.slug])
            response = self.client.post(url, {
                'projects': [self.project.id],
                'aggregations': [['count()', None, 'count']],
                'conditionFields': [
                    [
                        'if',
                        [
                            [
                                'in',
                                [
                                    'release',
                                    'tuple',
                                    ["'foo'"],
                                ],
                            ],
                            'release',
                            "'other'",
                        ],
                        'release',
                    ],
                ],
                'start': (datetime.now() - timedelta(seconds=10)).strftime('%Y-%m-%dT%H:%M:%S'),
                'end': (datetime.now()).strftime('%Y-%m-%dT%H:%M:%S'),
                'groupby': ['time', 'release'],
                'rollup': 86400,
                'limit': 1000,
                'orderby': '-time',
                'range': None,
            })

        assert response.status_code == 200, response.content

        # rollup is by one day and diff of start/end is 10 seconds, so we only have one day
        assert len(response.data['data']) == 2

        for data in response.data['data']:
            # note this "release" key represents the alias for the column condition
            # and is also used in `groupby`, it is NOT the release tag
            if data['release'] == 'foo':
                assert data['count'] == 1
            elif data['release'] == 'other':
                assert data['count'] == 2

    def test_invalid_range_value(self):
        with self.feature('organizations:discover'):
            url = reverse('sentry-api-0-organization-discover-query', args=[self.org.slug])
            response = self.client.post(url, {
                'projects': [self.project.id],
                'fields': ['message', 'platform'],
                'range': '1x',
                'orderby': '-timestamp',
                'start': None,
                'end': None,
            })

        assert response.status_code == 400, response.content

    def test_invalid_aggregation_function(self):
        with self.feature('organizations:discover'):
            url = reverse('sentry-api-0-organization-discover-query', args=[self.org.slug])
            response = self.client.post(url, {
                'projects': [self.project.id],
                'fields': ['message', 'platform'],
                'aggregations': [['test', 'test', 'test']],
                'range': '14d',
                'orderby': '-timestamp',
                'start': None,
                'end': None,
            })

        assert response.status_code == 400, response.content

    def test_boolean_condition(self):
        with self.feature('organizations:discover'):
            url = reverse('sentry-api-0-organization-discover-query', args=[self.org.slug])
            response = self.client.post(url, {
                'projects': [self.project.id],
                'fields': ['message', 'platform.name', 'stack.in_app'],
                'conditions': [['stack.in_app', '=', True]],
                'start': (datetime.now() - timedelta(seconds=10)).strftime('%Y-%m-%dT%H:%M:%S'),
                'end': (datetime.now()).strftime('%Y-%m-%dT%H:%M:%S'),
                'orderby': '-timestamp',
                'range': None,
            })

        assert response.status_code == 200, response.content
        assert len(response.data['data']) == 1
        assert response.data['data'][0]['message'] == 'message!'
        assert response.data['data'][0]['platform.name'] == 'python'

    def test_strip_double_quotes_in_condition_strings(self):
        with self.feature('organizations:discover'):
            url = reverse('sentry-api-0-organization-discover-query', args=[self.org.slug])
            response = self.client.post(url, {
                'projects': [self.project.id],
                'fields': ['message'],
                'conditions': [['message', '=', '"message!"']],
                'range': '14d',
                'orderby': '-timestamp',
            })

        assert response.status_code == 200, response.content
        assert len(response.data['data']) == 1
        assert response.data['data'][0]['message'] == 'message!'

    def test_array_join(self):
        with self.feature('organizations:discover'):
            url = reverse('sentry-api-0-organization-discover-query', args=[self.org.slug])
            response = self.client.post(url, {
                'projects': [self.project.id],
                'fields': ['message', 'error.type'],
                'start': (datetime.now() - timedelta(seconds=10)).strftime('%Y-%m-%dT%H:%M:%S'),
                'end': (datetime.now() + timedelta(seconds=10)).strftime('%Y-%m-%dT%H:%M:%S'),
                'orderby': '-timestamp',
                'range': None,
            })
        assert response.status_code == 200, response.content
        assert len(response.data['data']) == 1
        assert response.data['data'][0]['error.type'] == 'ValidationError'

    def test_array_condition_equals(self):
        with self.feature('organizations:discover'):
            url = reverse('sentry-api-0-organization-discover-query', args=[self.org.slug])
            response = self.client.post(url, {
                'projects': [self.project.id],
                'conditions': [['error.type', '=', 'ValidationError']],
                'fields': ['message'],
                'start': (datetime.now() - timedelta(seconds=10)).strftime('%Y-%m-%dT%H:%M:%S'),
                'end': (datetime.now()).strftime('%Y-%m-%dT%H:%M:%S'),
                'orderby': '-timestamp',
                'range': None,
            })
        assert response.status_code == 200, response.content
        assert len(response.data['data']) == 1

    def test_array_condition_not_equals(self):
        with self.feature('organizations:discover'):
            url = reverse('sentry-api-0-organization-discover-query', args=[self.org.slug])
            response = self.client.post(url, {
                'projects': [self.project.id],
                'conditions': [['error.type', '!=', 'ValidationError']],
                'fields': ['message'],
                'start': (datetime.now() - timedelta(seconds=10)).strftime('%Y-%m-%dT%H:%M:%S'),
                'end': (datetime.now()).strftime('%Y-%m-%dT%H:%M:%S'),
                'orderby': '-timestamp',
                'range': None,
            })

        assert response.status_code == 200, response.content
        assert len(response.data['data']) == 0

    def test_select_project_name(self):
        with self.feature('organizations:discover'):
            url = reverse('sentry-api-0-organization-discover-query', args=[self.org.slug])
            response = self.client.post(url, {
                'projects': [self.project.id],
                'fields': ['project.name'],
                'range': '14d',
                'orderby': '-timestamp',
                'start': None,
                'end': None,
            })
        assert response.status_code == 200, response.content
        assert len(response.data['data']) == 1
        assert(response.data['data'][0]['project.name']) == 'bar'

    def test_groupby_project_name(self):
        with self.feature('organizations:discover'):
            url = reverse('sentry-api-0-organization-discover-query', args=[self.org.slug])
            response = self.client.post(url, {
                'projects': [self.project.id],
                'aggregations': [['count()', '', 'count']],
                'fields': ['project.name'],
                'range': '14d',
                'orderby': '-count',
                'start': None,
                'end': None,
            })
        assert response.status_code == 200, response.content
        assert len(response.data['data']) == 1
        assert(response.data['data'][0]['project.name']) == 'bar'
        assert(response.data['data'][0]['count']) == 1

    def test_zerofilled_dates_when_rollup_relative(self):
        with self.feature('organizations:discover'):
            url = reverse('sentry-api-0-organization-discover-query', args=[self.org.slug])
            response = self.client.post(url, {
                'projects': [self.project.id],
                'aggregations': [['count()', '', 'count']],
                'fields': ['project.name'],
                'groupby': ['time'],
                'orderby': 'time',
                'range': '5d',
                'rollup': 86400,
                'start': None,
                'end': None,
            })
        assert response.status_code == 200, response.content
        assert len(response.data['data']) == 6
        assert(response.data['data'][5]['time']) > response.data['data'][4]['time']
        assert(response.data['data'][5]['project.name']) == 'bar'
        assert(response.data['data'][5]['count']) == 1

    def test_zerofilled_dates_when_rollup_absolute(self):
        with self.feature('organizations:discover'):
            url = reverse('sentry-api-0-organization-discover-query', args=[self.org.slug])
            response = self.client.post(url, {
                'projects': [self.project.id],
                'aggregations': [['count()', '', 'count']],
                'fields': ['project.name'],
                'groupby': ['time'],
                'orderby': '-time',
                'start': (self.now - timedelta(seconds=300)).strftime('%Y-%m-%dT%H:%M:%S'),
                'end': self.now.strftime('%Y-%m-%dT%H:%M:%S'),
                'rollup': 60,
                'range': None,
            })

        assert response.status_code == 200, response.content
        assert len(response.data['data']) == 6
        assert(response.data['data'][0]['time']) > response.data['data'][2]['time']
        assert(response.data['data'][0]['project.name']) == 'bar'
        assert(response.data['data'][0]['count']) == 1

    def test_uniq_project_name(self):
        with self.feature('organizations:discover'):
            url = reverse('sentry-api-0-organization-discover-query', args=[self.org.slug])
            response = self.client.post(url, {
                'projects': [self.project.id],
                'aggregations': [['uniq', 'project.name', 'uniq_project_name']],
                'range': '14d',
                'orderby': '-uniq_project_name',
                'start': None,
                'end': None,
            })
        assert response.status_code == 200, response.content
        assert len(response.data['data']) == 1
        assert(response.data['data'][0]['uniq_project_name']) == 1

    def test_meta_types(self):
        with self.feature('organizations:discover'):
            url = reverse('sentry-api-0-organization-discover-query', args=[self.org.slug])
            response = self.client.post(url, {
                'projects': [self.project.id],
                'fields': ['project.id', 'project.name'],
                'aggregations': [['count()', '', 'count']],
                'range': '14d',
                'orderby': '-count',
                'start': None,
                'end': None,
            })
        assert response.status_code == 200, response.content
        assert response.data['meta'] == [
            {'name': 'project.id', 'type': 'integer'},
            {'name': 'project.name', 'type': 'string'},
            {'name': 'count', 'type': 'integer'}
        ]

    def test_no_feature_access(self):
        url = reverse('sentry-api-0-organization-discover-query', args=[self.org.slug])
        response = self.client.post(url, {
            'projects': [self.project.id],
            'fields': ['message', 'platform'],
            'range': '14d',
            'orderby': '-timestamp',
            'start': None,
            'end': None,
        })

        assert response.status_code == 404, response.content

    def test_invalid_project(self):
        with self.feature('organizations:discover'):
            url = reverse('sentry-api-0-organization-discover-query', args=[self.org.slug])
            response = self.client.post(url, {
                'projects': [self.other_project.id],
                'fields': ['message', 'platform'],
                'range': '14d',
                'orderby': '-timestamp',
                'start': None,
                'end': None,
            })

        assert response.status_code == 403, response.content

    def test_superuser(self):
        self.new_org = self.create_organization(name='foo_new')
        self.new_project = self.create_project(
            name='bar_new',
            organization=self.new_org,
        )
        self.login_as(user=self.user, superuser=True)

        with self.feature('organizations:discover'):
            url = reverse('sentry-api-0-organization-discover-query', args=[self.new_org.slug])
            response = self.client.post(url, {
                'projects': [self.new_project.id],
                'fields': ['message', 'platform'],
                'start': (datetime.now() - timedelta(seconds=10)).strftime('%Y-%m-%dT%H:%M:%S'),
                'end': (datetime.now()).strftime('%Y-%m-%dT%H:%M:%S'),
                'orderby': '-timestamp',
                'range': None,
            })

        assert response.status_code == 200, response.content
