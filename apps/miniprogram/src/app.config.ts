import { BRAND_NAME } from './brand';

export default defineAppConfig({ pages: ['pages/index/index', 'pages/editor/index', 'pages/activity/index', 'pages/diagnostics/index'], window: { navigationBarTitleText: BRAND_NAME, navigationBarBackgroundColor: '#f5f7f3', navigationBarTextStyle: 'black', backgroundColor: '#f5f7f3', backgroundTextStyle: 'dark' } });
