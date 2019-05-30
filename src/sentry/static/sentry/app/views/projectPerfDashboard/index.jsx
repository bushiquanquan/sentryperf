import PropTypes from 'prop-types';
import React from 'react';
import createReactClass from 'create-react-class';
import {Link} from 'react-router';
import DocumentTitle from 'react-document-title';

import SentryTypes from 'app/sentryTypes';
import ProjectState from 'app/mixins/projectState';
import PageHeading from 'app/components/pageHeading';
import {t} from 'app/locale';
import withEnvironmentInQueryString from 'app/utils/withEnvironmentInQueryString';

import EventList from './eventList';
import ProjectChart from './chart';

const PERIOD_HOUR = '1h';
const PERIOD_DAY = '1d';
const PERIOD_WEEK = '1w';
const PERIOD_MONTH = '1m';
const PERIODS = new Set([PERIOD_HOUR, PERIOD_DAY, PERIOD_WEEK, PERIOD_MONTH]);

// 分位
const QUANTILE_ALL = 'all';
const QUANTILE_50 = '50';
const QUANTILE_90 = '90';

const ProjectDashboard = createReactClass({
  displayName: 'ProjectPerfDashboard',

  propTypes: {
    defaultQuantile: PropTypes.string,
    defaultStatsPeriod: PropTypes.string,
    setProjectNavSection: PropTypes.func,
    environment: SentryTypes.Environment,
  },

  mixins: [ProjectState],

  getDefaultProps() {
    return {
      statsUsedCount: 0,
      defaultStatsPeriod: PERIOD_DAY,
      defaultQuantile: QUANTILE_ALL,
    };
  },

  getInitialState() {
    return {
      statsUsedCount: 0,
      statsPeriod: this.props.defaultStatsPeriod,
      quantile: this.props.defaultQuantile,
      ...this.getQueryStringState(),
    };
  },

  componentWillMount() {
    this.statsUsedCount = 0;
    this.props.setProjectNavSection('perfDashboard');
  },

  componentDidMount() {
    this.statsUsedCount = 1;
  },

  componentWillReceiveProps(nextProps) {
    this.setState(this.getQueryStringState(nextProps));
  },

  getQueryStringState(props) {
    props = props || this.props;
    const currentQuery = props.location.query;
    let statsPeriod = currentQuery.statsPeriod;

    if (!PERIODS.has(statsPeriod)) {
      statsPeriod = props.defaultStatsPeriod;
    }

    return {
      quantile: currentQuery.quantile || QUANTILE_ALL,
      statsPeriod,
    };
  },

  getStatsPeriodBeginTimestamp(statsPeriod) {
    // 获取当前开始时间，精确到小时,解决后面小时计算问题
    const now = new Date(window.moment(new Date()).format('YYYY-MM-DD HH') + ':0:0').getTime() / 1000;
    switch (statsPeriod) {
      case PERIOD_MONTH:
        return now - 3600 * 24 * 31;
      case PERIOD_WEEK:
        return now - 3600 * 24 * 7;
      case PERIOD_HOUR:
        return now - 3600;
      case PERIOD_DAY:
      default:
        return now - 3600 * 24;
    }
  },

  getStatsPeriodResolution(statsPeriod) {
    switch (statsPeriod) {
      case PERIOD_MONTH:
      case PERIOD_WEEK:
        return '1d';
      case PERIOD_HOUR:
        return '1h';
      case PERIOD_DAY:
      default:
        return '1h';
    }
  },

  getChatData(data) {
    console.log(data);
    // this.setState({statsUsedCount: data});
    this.statsUsedCount = data;
    // this.forceUpdate();
  },

  render() {
    const {statsPeriod, quantile} = this.state;
    const dateSince = this.getStatsPeriodBeginTimestamp(statsPeriod);
    const resolution = this.getStatsPeriodResolution(statsPeriod);
    const {orgId, projectId} = this.props.params;
    const {name: orgName} = this.getOrganization();
    const {slug: projectSlug} = this.getProject();
    const url = `/${orgId}/${projectId}/performance/`;
    const routeQuery = this.props.location.query;

    return (
      <DocumentTitle title={`Overview - ${projectSlug} - ${orgName} - Sentry`}>
        <div>
          <div className="row" style={{marginBottom: '5px'}}>
            <div className="col-sm-7">
              {/*+ ' 总采样数' + this.statsUsedCount*/}
              <PageHeading withMargins>{t('性能概览(时间:ms)')}</PageHeading>
            </div>
            <div className="col-sm-5" style={{textAlign: 'right', marginTop: '4px'}}>
              <div className="btn-group" style={{marginRight: '20px'}}>
                <Link
                    to={{
                      pathname: url,
                      query: {...routeQuery, quantile: 'all'},
                    }}
                    className={
                      'btn btn-sm btn-default' +
                      (quantile === QUANTILE_ALL ? ' active' : '')
                    }
                >
                  {'全部'}
                </Link>
                <Link
                    to={{
                      pathname: url,
                      query: {...routeQuery, quantile: 50},
                    }}
                    className={
                      'btn btn-sm btn-default' +
                      (quantile === QUANTILE_50 ? ' active' : '')
                    }
                >
                  {'50分位'}
                </Link>
                <Link
                    to={{
                      pathname: url,
                      query: {...routeQuery, quantile: 90},
                    }}
                    className={
                      'btn btn-sm btn-default' +
                      (quantile === QUANTILE_90 ? ' active' : '')
                    }
                >
                  {'90分位'}
                </Link>
              </div>
              <div className="btn-group">
                <Link
                  to={{
                    pathname: url,
                    query: {...routeQuery, statsPeriod: PERIOD_DAY},
                  }}
                  className={
                    'btn btn-sm btn-default' +
                    (statsPeriod === PERIOD_DAY ? ' active' : '')
                  }
                >
                  {'昨日'}
                </Link>
                <Link
                  to={{
                    pathname: url,
                    query: {...routeQuery, statsPeriod: PERIOD_WEEK},
                  }}
                  className={
                    'btn btn-sm btn-default' +
                    (statsPeriod === PERIOD_WEEK ? ' active' : '')
                  }
                >
                  {'近一周'}
                </Link>
                <Link
                    to={{
                      pathname: url,
                      query: {...routeQuery, statsPeriod: PERIOD_MONTH},
                    }}
                    className={
                      'btn btn-sm btn-default' +
                      (statsPeriod === PERIOD_MONTH ? ' active' : '')
                    }
                >
                  {'近一月'}
                </Link>
              </div>
            </div>
          </div>
          <ProjectChart GetStates={this.getChatData}
            dateSince={dateSince}
            quantile={quantile}
            resolution={resolution}
            environment={this.props.environment}
          />
        </div>
      </DocumentTitle>
    );
  },
});

export default withEnvironmentInQueryString(ProjectDashboard);
