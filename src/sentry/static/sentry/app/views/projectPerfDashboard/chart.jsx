import PropTypes from 'prop-types';
import React from 'react';
import styled from 'react-emotion';
import createReactClass from 'create-react-class';
import moment from 'moment';
import SentryTypes from 'app/sentryTypes';
import withApi from 'app/utils/withApi';
import BarChart from 'app/components/barChart';
import DynamicWrapper from 'app/components/dynamicWrapper';
import LoadingError from 'app/components/loadingError';
import LoadingIndicator from 'app/components/loadingIndicator';
import ProjectState from 'app/mixins/projectState';
import LineChart from 'app/components/charts/lineChart';
import PieChart from 'app/components/charts/pieChart';

const ProjectChart = createReactClass({
  displayName: 'ProjectPerfChart',

  propTypes: {
    api: PropTypes.object,
    dateSince: PropTypes.number.isRequired,
    resolution: PropTypes.string.isRequired,
    environment: SentryTypes.Environment,
  },

  mixins: [ProjectState],

  getInitialState() {
    return {
      loading: true,
      error: false,
      stats: [],
      releaseList: [],
      environment: this.props.environment,
    };
  },

  componentWillMount() {
    this.pieDataTool = {ttfb: {}, domInteractive: {}, load: {}};
    this.fetchData();
  },

  componentWillReceiveProps(nextProps) {
    if (
      nextProps.environment !== this.props.environment ||
      nextProps.resolution !== this.props.resolution ||
      nextProps.dateSince !== this.props.dateSince
    ) {
      this.setState(
        {
          environment: nextProps.environment,
          loading: true,
          error: false,
        },
        this.fetchData
      );
    }
  },

  // 获取性能issueID
  getStatsEndpoint() {
    const org = this.getOrganization();
    const project = this.getProject();
    return '/projects/' + org.slug + '/' + project.slug + '/issues/?query=JustFor_Performance&limit=25&shortIdLookup=1';
  },

  getProjectReleasesEndpoint() {
    const org = this.getOrganization();
    const project = this.getProject();
    return '/projects/' + org.slug + '/' + project.slug + '/releases/';
  },

  getPerfEndpoint() {
    return '/issues/' + this.issueId + '/events/?limit=500000&query=';
  },

  request(url, query) {
    return new Promise((resolve, reject) => {
      this.props.api.request(url, {
        query: query || {},
        success: data => {
          resolve(data);
        },
        error: e => {
          reject(e);
        },
      });
    });
  },
  fetchIssueData () {
    if (this.issueId) {
      this.fetchPerfData();
      return;
    }
    this.request(this.getStatsEndpoint()).then(data => {
      if (data && data[0]) {
        this.issueId = data[0].id;
        this.fetchPerfData();
      }
    }).catch(() => {
      this.setState({
        error: true,
        loading: false,
      });
    });
  },
  fetchPerfData () {
    this.request(this.getPerfEndpoint()).then(res => {
      this.setState({
        stats: res,
        error: false,
        loading: false,
      });
    });
  },
  fetchData() {
    const statsQuery = {
      since: this.props.dateSince,
      resolution: this.props.resolution,
      stat: 'generated',
    };

    const releasesQuery = {};

    if (this.state.environment) {
      statsQuery.environment = this.state.environment.name;
      releasesQuery.environment = this.state.environment.name;
    }
    this.fetchIssueData();
  },

  // 处理数据
  manageData() {
    this.statsUsedCount = 0;
    let stats = this.state.stats;
    let result = {
      ttfb: [],
      domInteractive: [],
      load: [],
      browserData: [],
      ttfbPieData: [],
      domInteractivePieData: [],
      loadPieData: [],
    };
    // 存储浏览器信息
    let browserTool = {};
    // 分位
    let quantileType = this.props.quantile;
    let dateSince = this.props.dateSince;
    const now = Date.now() / 1000;

    // 时段：昨日全天，每半小时一个点
    // 近一周：每天一个点
    // 近一月：每天一个点
    let resolutionType = this.props.resolution;
    let beginTime = resolutionType === '1d' ? (new Date(window.moment(dateSince * 1000).format('YYYY-MM-DD') + ' 0:0:0').getTime() / 1000) : dateSince;
    while (beginTime < now) {
      let nextBeginTime = resolutionType === '1d' ? beginTime + 3600 * 24 : beginTime + 3600;
      let ttfbScore = 0;
      let domInteractiveScore = 0;
      let loadScore = 0;
      let points = stats.filter(release => {
        let currentPointTime = new Date(release.dateCreated).getTime() / 1000;
        if (currentPointTime >= beginTime && currentPointTime < nextBeginTime) {
          this.statsUsedCount++;
          if (!browserTool[release.contexts.browser.name]) {
            browserTool[release.contexts.browser.name] = 1;
          } else {
            browserTool[release.contexts.browser.name]++;
          }
          // 性能分级
          // 首字节：<50:好;50-100:正常；>100:差
          // 可交互：<1500:好;1500-2000:正常；>2000:差
          // 完全加载：<1500:好;1500-3000:正常；>3000:差
          this.getPieData('ttfb', release)
          this.getPieData('domInteractive', release)
          this.getPieData('load', release)

          ttfbScore += release.context.ttfb || 0
          domInteractiveScore += release.context.domInteractive || 0;
          loadScore += release.context.load || 0;
          return true;
        }
      });
      // 获取分位:n个数自小到大排序，每个四分位间 (n-1)/4 个数；则获x分位为 1+(n-1)/4*x/25=1+(n-1)*x/100,
      // 若结果为6.5则指第6个数对应的值65及第6个数与第7个数之间的0.5位置处,即：65+(0.5)*(78-65)=71.5 （71.5为50分位值）。
      if (quantileType !== 'all' && points.length) {
        let index = 1 + (points.length - 1) * Number(quantileType) / 100;
        let ttfbSorted = points.sort((a, b) => {
          return a.context.ttfb - b.context.ttfb;
        });
        let inteactiveSorted = points.sort((a, b) => {
          return a.context.domInteractive - b.context.domInteractive;
        });
        let loadSorted = points.sort((a, b) => {
          return a.context.load - b.context.load;
        });
        // console.log(ttfbSorted, inteactiveSorted, loadSorted);
        let indexInt = parseInt(index, 10);
        ttfbScore = (ttfbSorted[indexInt - 1].context.ttfb || 0) + (points.length > 1 ? (index - indexInt) * ((ttfbSorted[indexInt].context.ttfb || 0) - (ttfbSorted[indexInt - 1].context.ttfb || 0)) : 0);
        domInteractiveScore = (inteactiveSorted[indexInt - 1].context.domInteractive || 0) + (points.length > 1 ? (index - indexInt) * ((inteactiveSorted[indexInt].context.domInteractive || 0) - (inteactiveSorted[indexInt - 1].context.domInteractive || 0)) : 0);
        loadScore = (loadSorted[indexInt - 1].context.load || 0) + (points.length > 1 ? (index - indexInt) * ((loadSorted[indexInt].context.load || 0) - (loadSorted[indexInt - 1].context.load || 0)) : 0);
      }
      let x = moment(beginTime * 1000).format('YYYY-MM-DD' + (resolutionType === '1d' ? '' : ' HH')) + (resolutionType !== '1d' ? '时' : '');
      result.ttfb.push({name: x, value: quantileType !== 'all' ? ttfbScore : ttfbScore / (points.length || 1)});
      result.domInteractive.push({name: x, value: quantileType !== 'all' ? domInteractiveScore : domInteractiveScore / (points.length || 1)});
      result.load.push({name: x, value: quantileType !== 'all' ? loadScore : loadScore / (points.length || 1)});
      beginTime = nextBeginTime;
    }
    this.props.GetStates(this.statsUsedCount);
    Object.keys(browserTool).forEach(key => {
      result.browserData.push({name: key, value: browserTool[key]});
    });
    // 设置性能好坏比例饼图数据
    let pieDataTool = this.pieDataTool
    Object.keys(pieDataTool).forEach(key => {
      if (pieDataTool[key]) {
        Object.keys(pieDataTool[key]).forEach(i => {
          result[key + 'PieData'].push({name: i, value: pieDataTool[key][i]});
        });
      }
    });
    // 清空
    this.pieDataTool = {ttfb: {}, domInteractive: {}, load: {}};
    return result;
  },
  renderChart() {
    const {ttfb, domInteractive, load, browserData, ttfbPieData, domInteractivePieData, loadPieData} = this.manageData();
    console.log(ttfbPieData, domInteractivePieData, loadPieData);
    const series = [
      {
        seriesName: '首字节',
        data: ttfb,
      },
      {
        seriesName: '可交互',
        data: domInteractive,
      },
      {
        seriesName: '完全加载',
        data: load,
      }];
    const seriesOptions = {
      showSymbol: true,
      xAxis: {
        type: 'category',
        splitLine: {
          show: true,
        },
      },
      yAxis: {
        type: 'value',
        boundaryGap: [0, '100%'],
        splitLine: {
          show: true,
        },
      },
    };
    return (
      <div className="chart-wrapper">
        <LineChart
          style={{height: 200}}
          seriesOptions={seriesOptions}
          series={series}
        />
        <h2 style={{'fontWeight': 'normal', 'fontSize': '22px', margin: 0, color: '#4A3E56', position: 'absolute', top: '29px', left: '226px'}}>{'总采样数' + this.statsUsedCount}</h2>
        <section style={{display:'flex', justifyContent: 'space-between'}}>
          <div style={{width: '45%'}}>
            <h2 style={{'fontWeight': 'normal', 'fontSize': '14px', margin: '10px 0', color: '#4A3E56'}}>{'性能占比'}</h2>
            <div
                style={{display:'flex', borderRadius: '4px 4px 0 0', 'boxShadow': '0 5px 5px -5px rgba(0, 0, 0, 0.3)', border: '1px solid rgb(204, 204, 204)'}}>
              <PieChart
                  style={{width: '100%'}}
                  series={[
                    {
                      seriesName: '首字节',
                      data: ttfbPieData
                    },
                  ]}
              />
              <PieChart
                  style={{width: '100%'}}
                  series={[
                    {
                      seriesName: '可交互',
                      data: domInteractivePieData
                    },
                  ]}
              />
              <PieChart
                  style={{width: '100%'}}
                  series={[
                    {
                      seriesName: '完全加载',
                      data: loadPieData
                    },
                  ]}
              />
            </div>
          </div>
          <div style={{width: '45%'}}>
            <h2 style={{'fontWeight': 'normal', 'fontSize': '14px', margin: '10px 0', color: '#4A3E56'}}>{'浏览器分析'}</h2>
            <div
                style={{display:'flex', borderRadius: '4px 4px 0 0', 'boxShadow': '0 5px 5px -5px rgba(0, 0, 0, 0.3)', border: '1px solid rgb(204, 204, 204)'}}>
              <PieChart
                  style={{width: '100%'}}
                  startDate={new Date()}
                  series={[
                    {
                      seriesName: '浏览器',
                      data: browserData
                    },
                  ]}
              />
            </div>
          </div>
        </section>

        {/*<h2 style={{'fontWeight': 'normal', 'fontSize': '22px', margin: 0, color: '#4A3E56'}}>{series[0].seriesName}</h2>*/}
        {/*<LineChart*/}
            {/*style={{height: 200}}*/}
            {/*seriesOptions={seriesOptions}*/}
            {/*series={[series[0]]}*/}
        {/*/>*/}
        {/*<h2 style={{'fontWeight': 'normal', 'fontSize': '22px', margin: 0, color: '#4A3E56'}}>{series[1].seriesName}</h2>*/}
        {/*<LineChart*/}
            {/*style={{height: 200}}*/}
            {/*seriesOptions={seriesOptions}*/}
            {/*series={[series[1]]}*/}
        {/*/>*/}
        {/*<h2 style={{'fontWeight': 'normal', 'fontSize': '22px', margin: 0, color: '#4A3E56'}}>{series[2].seriesName}</h2>*/}
        {/*<LineChart*/}
            {/*style={{height: 200}}*/}
            {/*seriesOptions={seriesOptions}*/}
            {/*series={[series[2]]}*/}
        {/*/>*/}
        <small className="date-legend">
          <DynamicWrapper
            fixed="Test Date 1, 2000"
            value={'数据起始时间：' + moment(this.props.dateSince * 1000).format('YYYY-MM-DD HH:mm:ss')}
          />
        </small>
      </div>
    );
  },
  getPieData(metricType, point) {
    let name = '正常';
    let niceMetric = 0;
    let badMetric = 0;
    if (metricType === 'ttfb') {
      // 可交互：<1500:好;1500-2000:正常；>2000:差
      // 完全加载：<1500:好;1500-3000:正常；>3000:差
      niceMetric = 50;
      badMetric = 100;
    } else if (metricType === 'domInteractive') {
      niceMetric = 1500;
      badMetric = 2000;
    } else {
      niceMetric = 1500;
      badMetric = 3000;
    }
    if (point.context[metricType] > badMetric) {
      name = '差';
    } else if (point.context[metricType] < niceMetric) {
      name = '好';
    }
    debugger;
    if (!this.pieDataTool[metricType][name]) {
      this.pieDataTool[metricType][name] = 1;
    } else {
      this.pieDataTool[metricType][name]++;
    }
  },
  render() {
    return this.state.loading ? (
      <LoadingIndicator />
    ) : this.state.error ? (
      <LoadingError onRetry={this.fetchData} />
    ) : (
      this.renderChart()
    );
  },
});

const StyledBarChart = styled(BarChart)`
  background: #fff;
`;

export {ProjectChart};

export default withApi(ProjectChart);
