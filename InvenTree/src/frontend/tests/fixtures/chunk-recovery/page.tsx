import './page.css';
export default function FixturePage() {
  if (new URLSearchParams(window.location.search).has('crash'))
    throw new Error('ordinary render failure');
  return <h1 className='chunk-loaded'>批次页面加载成功</h1>;
}
