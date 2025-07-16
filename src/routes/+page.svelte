<script lang="ts">
	import Footer from '$lib/components/Footer.svelte'

	import resources from '$lib/resources.json'
</script>

<div class="flex flex-col min-h-screen has-header-img font-nunito">
  <div class="flex grow items-center justify-start px-8 md:px-14 py-10">
    <div class="grid grid-cols-1 md:grid-cols-2 items-center">
      <div>
        <p class="mb-4"><img src="/images/eda.png" width="60" alt="Logo" /></p>
        <h3 class="text-3xl text-yellow-300 font-light mt-6">EDA Resource Browser</h3>
        <div class="text-gray-300 mt-2 max-w-[500px] text-sm">
          <p>View Custom Resource Definition (CRD)</p>
        </div>
        <!--<a class="px-2 py-2 rounded-lg text-nowrap text-center text-white bg-gray-600 hover:bg-gray-700" href="/offline">Custom CRD</a>-->
      </div>
      <div class="bg-white dark:bg-gray-800 rounded shadow-xl">
				<div class="h-[300px] max-w-[450px] lg:w-[450px] overflow-y-auto scroll-light dark:scroll-dark">
					<ul>
						{#each resources as resource, i}
							<li class="items-center p-4 text-gray-900 hover:bg-gray-100 {i > 0 ? 'border-t dark:border-gray-700' : ''} dark:hover:bg-gray-700">
								<a href={resource}>
									<p class="dark:text-white">{resource}</p>
								</a>
							</li>
						{/each}
					</ul>
				</div>
			</div>
    </div>
  </div>
  <div class="shrink-0">
    <Footer home={true} />
  </div>
</div>
