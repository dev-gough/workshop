export default function ThemeScript() {
	const script = `
		(function() {
			var cookie = document.cookie.match(/theme=(light|dark)/);
			var theme = cookie ? cookie[1] : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
			if (theme === 'dark') document.documentElement.classList.add('dark');
		})();
	`;
	return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
