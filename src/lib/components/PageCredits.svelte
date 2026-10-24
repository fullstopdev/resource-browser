<script lang="ts">
	/** Compact variant: identical minimal line, kept for API compatibility. */
	export let compact: boolean = false;
	void compact;

	const year = new Date().getFullYear();
</script>

<!-- The one site footer (every page). -->
<footer class="rb-footer">
	<div class="rb-footer-inner">
		<p>
			Unofficial reference built from public EDA CRDs and OpenAPI specs. Not affiliated with or
			endorsed by Nokia. © {year}
		</p>
		<nav class="rb-footer-links" aria-label="Footer">
			<a href="/docs">Docs</a>
			<a href="https://github.com/fullstopdev/resource-browser" target="_blank" rel="noopener noreferrer">
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.009-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.339-2.221-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.31.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" /></svg>
				GitHub
			</a>
		</nav>
	</div>
</footer>

<style>
	.rb-footer {
		margin-top: 2.5rem;
		border-top: 1px solid var(--rb-line);
		background: var(--rb-bg);
		font-family: var(--rb-font);
	}
	.rb-footer-inner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1.5rem;
		max-width: 80rem;
		margin: 0 auto;
		padding: 1rem max(1rem, env(safe-area-inset-right, 0px)) calc(1rem + env(safe-area-inset-bottom, 0px))
			max(1rem, env(safe-area-inset-left, 0px));
		font-size: 0.8rem;
		color: var(--rb-ink-3);
	}
	@media (min-width: 1024px) {
		.rb-footer-inner {
			padding-left: 2.5rem;
			padding-right: 2.5rem;
		}
	}
	p {
		margin: 0;
		max-width: 60ch;
	}
	.rb-footer-links {
		display: flex;
		gap: 1.25rem;
	}
	.rb-footer-links a {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		color: var(--rb-ink-2);
		font-weight: 500;
		text-decoration: none;
	}
	.rb-footer-links a:hover {
		color: var(--rb-signal);
	}
	.rb-footer-links svg {
		width: 0.875rem;
		height: 0.875rem;
		fill: currentColor;
	}
</style>
