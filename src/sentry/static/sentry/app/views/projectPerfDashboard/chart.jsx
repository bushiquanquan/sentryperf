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
// import LineChart from 'app/components/charts/lineChart';
// import PieChart from 'app/components/charts/pieChart';

// import Data from './data';
import ReactEcharts from 'echarts-for-react';

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
    fetchIssueData() {
        if (this.issueId) {
            this.fetchPerfData();
            return;
        }
        this.request(this.getStatsEndpoint()).then(data => {
            if (data && data[0]) {
                this.issueId = data[0].id;
                this.fetchPerfData();
            } else {
                this.setState({
                    error: false,
                    loading: false,
                });
            }
        }).catch(() => {
            this.setState({
                error: true,
                loading: false,
            });
        });
    },
    fetchPerfData() {
        // this.setState({
        //     stats: Data,
        //     error: false,
        //     loading: false,
        // });
        // return;
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
            pvData: []
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
                    if (!release.contexts.browser) {
                        release.contexts.browser = {name: 'other'};
                    }
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
            result.ttfb.push({
                name: x, value: quantileType !== 'all' ? ttfbScore : ttfbScore / (points.length
                )
            });
            result.domInteractive.push({
                name: x,
                value: quantileType !== 'all' ? domInteractiveScore : domInteractiveScore / (points.length || 1)
            });
            result.load.push({name: x, value: quantileType !== 'all' ? loadScore : loadScore / (points.length || 1)});
            result.pvData.push(points.length);
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
    // 获取饼图配置
    getPieOption(data) {
        let color = [
            '#37a6fb',
            '#ff485a',
            '#f5883b',
            '#ffbf00'
        ];
        let option = {
            title: {
                text: '性能优劣占比',
                subtext: '首字节：<50:好;50-100:正常；>100:差。可交互：<1500:好;1500-2000:正常；>2000:差。完全加载：<1500:好;1500-3000:正常；>3000:',
                x: 'center'
            },
            tooltip: {
                trigger: 'item',
                formatter: "{a} <br/>{b} : {c} ({d}%)"
            },
            // legend: {
            //     x : 'center',
            //     y : 'bottom',
            //     data:['rose1','rose2','rose3','rose4','rose5','rose6','rose7','rose8']
            // },
            color,
            toolbox: {
                show: true,
                feature: {
                    mark: {show: true},
                    dataView: {show: true, readOnly: false},
                    magicType: {
                        show: true,
                        type: ['pie', 'funnel']
                    },
                    restore: {show: true},
                    saveAsImage: {show: true}
                }
            },
            calculable: true,
            series: [
                {
                    name: '首字节',
                    type: 'pie',
                    radius: [30, 110],
                    center: ['17%', '53%'],
                    roseType: 'area',
                    data: []
                },
                {
                    name: '可交互',
                    type: 'pie',
                    radius: [30, 110],
                    center: ['51%', '53%'],
                    roseType: 'area',
                    data: []
                },
                {
                    name: '完全加载',
                    type: 'pie',
                    radius: [30, 110],
                    center: ['84%', '53%'],
                    roseType: 'area',
                    data: []
                }
            ]
        };
        option.series.forEach((i, index) => {
            i.data = data[index];
        });
        return option;
    },
    // 获取浏览器占比配置
    getBroserPieOption(data) {
        let option = {
            title: {
                text: '浏览器占比',
                subtext: '',
                x: 'center'
            },
            tooltip: {
                trigger: 'item',
                formatter: "{a} <br/>{b} : {c} ({d}%)"
            },
            toolbox: {
                show: true,
                feature: {
                    mark: {show: true},
                    dataView: {show: true, readOnly: false},
                    magicType: {
                        show: true,
                        type: ['pie', 'funnel']
                    },
                    restore: {show: true},
                    saveAsImage: {show: true}
                }
            },
            calculable: true,
            series: [
                {
                    name: '浏览器占比',
                    type: 'pie',
                    radius: [30, 110],
                    center: ['50%', '50%'],
                    roseType: 'area',
                    data: []
                }
            ]
        };
        option.series[0].data = data;
        return option;
    },
    // pv走势图
    getPvLineOption(xAxis, data) {
        let option = {
            title: {
                text: 'PV走势图'
            },
            tooltip: {
                trigger: 'axis'
            },
            legend: {
                data: ['PV']
            },
            grid: {
                left: '3%',
                right: '4%',
                bottom: '3%',
                containLabel: true
            },
            toolbox: {
                feature: {
                    saveAsImage: {}
                }
            },
            xAxis: {
                type: 'category',
                boundaryGap: false,
                data: []
            },
            yAxis: {
                type: 'value'
            },
            color: [
                '#37a6fb',
                '#ff485a'
            ],
            series: [
                {
                    name: 'PV',
                    type: 'line',
                    stack: '',
                    data: []
                }
            ]
        };
        option.xAxis.data = xAxis;
        option.series.forEach((i, index) => {
            i.data = data[index];
        });
        return option;
    },
    // 性能走势图
    getLineOption(xAxis, data) {
        let option = {
            title: {
                text: '性能走势图'
            },
            tooltip: {
                trigger: 'axis'
            },
            legend: {
                data: ['首字节', '首字节达标线', '可交互', '可交互达标线', '完全加载', '完全加载达标线']
            },
            grid: {
                left: '3%',
                right: '4%',
                bottom: '3%',
                containLabel: true
            },
            toolbox: {
                feature: {
                    saveAsImage: {}
                }
            },
            xAxis: {
                type: 'category',
                boundaryGap: false,
                data: []
            },
            yAxis: {
                type: 'value'
            },
            color: [
                '#7c6a8e',
                '#7c6a8e',
                '#37a6fb',
                '#37a6fb',
                '#ff485a',
                '#ff485a'
            ],
            series: [
                {
                    name: '首字节',
                    type: 'line',
                    stack: '',
                    data: []
                },
                {
                    name: '首字节达标线',
                    type: 'line',
                    standard: 500,
                    stack: '',
                    data: []
                },
                {
                    name: '可交互',
                    type: 'line',
                    stack: '',
                    data: []
                },
                {
                    name: '可交互达标线',
                    type: 'line',
                    standard: 1500,
                    stack: '',
                    data: []
                },
                {
                    name: '完全加载',
                    type: 'line',
                    standard: 3000,
                    stack: '',
                    data: []
                },
                {
                    name: '完全加载达标线1',
                    type: 'line',
                    stack: '',
                    data: []
                }
            ]
        };
        console.log('666666');
        option.xAxis.data = xAxis;
        option.series.forEach((i, index) => {
            // 排在偶数为数据线，其余为达标线
            if (!(index % 2)) {
                i.data = data[index / 2];
            } else {
                i.data = xAxis.map(() => {
                   return i.standard;
                });
            }

        });
        return option;
    },
    // 添加标准值
    addStandard() {

    },
    // get
    renderChart() {
        let {ttfb, domInteractive, load, browserData, ttfbPieData, domInteractivePieData, loadPieData, pvData} = this.manageData();
        console.log(ttfb, ttfbPieData, domInteractivePieData, loadPieData);
        // 新的数据格式
        let xAxis = [];
        let ttfbData = [];
        let domInteractiveData = [];
        let loadData = [];
        ttfb.forEach((i, index) => {
            xAxis.push(i.name);
            ttfbData.push(ttfb[index].value);
            domInteractiveData.push(domInteractive[index].value);
            loadData.push(load[index].value);
        });
        let option = this.getLineOption(xAxis, [ttfbData, domInteractiveData, loadData]);
        let pvOption = this.getPvLineOption(xAxis, [pvData]);
        let pieData = this.getPieOption([ttfbPieData, domInteractivePieData, loadPieData]);
        browserData = this.getBroserPieOption(browserData)
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
                <ReactEcharts
                    style={{height: 250}}
                    option={option}/>
                <ReactEcharts
                    style={{height: 250}}
                    option={pvOption}/>
                <h2 style={{
                    'fontWeight': 'normal',
                    'fontSize': '22px',
                    margin: 0,
                    color: '#4A3E56',
                    position: 'absolute',
                    top: '29px',
                    left: '226px'
                }}>{'总采样数' + this.statsUsedCount}</h2>
                <section style={{display: 'flex', justifyContent: 'space-between'}}>
                    <div style={{width: '100%'}}>
                        <h2 style={{
                            'fontWeight': 'normal',
                            'fontSize': '14px',
                            margin: '10px 0',
                            color: '#4A3E56'
                        }}>{''}</h2>
                        <div
                            style={{
                                display: 'flex',
                                borderRadius: '4px 4px 0 0',
                                'boxShadow': '0 5px 5px -5px rgba(0, 0, 0, 0.3)',
                                border: '1px solid rgb(204, 204, 204)'
                            }}>
                            <ReactEcharts
                                style={{width: '100%'}}
                                option={pieData}/>
                            {/*<PieChart*/}
                            {/*style={{width: '100%'}}*/}
                            {/*series={[*/}
                            {/*{*/}
                            {/*seriesName: '首字节',*/}
                            {/*data: ttfbPieData*/}
                            {/*},*/}
                            {/*]}*/}
                            {/*/>*/}
                            {/*<PieChart*/}
                            {/*style={{width: '100%'}}*/}
                            {/*series={[*/}
                            {/*{*/}
                            {/*seriesName: '可交互',*/}
                            {/*data: domInteractivePieData*/}
                            {/*},*/}
                            {/*]}*/}
                            {/*/>*/}
                            {/*<PieChart*/}
                            {/*style={{width: '100%'}}*/}
                            {/*series={[*/}
                            {/*{*/}
                            {/*seriesName: '完全加载',*/}
                            {/*data: loadPieData*/}
                            {/*},*/}
                            {/*]}*/}
                            {/*/>*/}
                        </div>
                    </div>
                    {/*<div style={{width: '45%'}}>*/}
                    {/*<h2 style={{'fontWeight': 'normal', 'fontSize': '14px', margin: '10px 0', color: '#4A3E56'}}>{'浏览器分析'}</h2>*/}
                    {/*<div*/}
                    {/*style={{display:'flex', borderRadius: '4px 4px 0 0', 'boxShadow': '0 5px 5px -5px rgba(0, 0, 0, 0.3)', border: '1px solid rgb(204, 204, 204)'}}>*/}
                    {/*<PieChart*/}
                    {/*style={{width: '100%'}}*/}
                    {/*startDate={new Date()}*/}
                    {/*series={[*/}
                    {/*{*/}
                    {/*seriesName: '浏览器',*/}
                    {/*data: browserData*/}
                    {/*},*/}
                    {/*]}*/}
                    {/*/>*/}
                    {/*</div>*/}
                    {/*</div>*/}
                </section>
                <section style={{display: 'flex', justifyContent: 'space-between'}}>
                    <div style={{width: '100%'}}>
                        <div
                            style={{
                                display: 'flex',
                                borderRadius: '4px 4px 0 0',
                                'boxShadow': '0 5px 5px -5px rgba(0, 0, 0, 0.3)',
                                border: '1px solid rgb(204, 204, 204)'
                            }}>
                            <ReactEcharts
                                style={{width: '100%'}}
                                option={browserData}/>
                        </div>
                    </div>
                </section>

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
        if (!this.pieDataTool[metricType][name]) {
            this.pieDataTool[metricType][name] = 1;
        } else {
            this.pieDataTool[metricType][name]++;
        }
    },
    render() {
        return this.state.loading ? (
            <LoadingIndicator/>
        ) : this.state.error ? (
            <LoadingError onRetry={this.fetchData}/>
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
