<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The "Show" pill — whose items every view displays: Personal (only the
  // logged-in user's), Local (this holon), or Global (this holon plus its
  // federation partners). One device-wide scope shared by all views; the
  // orthogonal Layout pill only changes how items render.
  import PillSwitch from "./PillSwitch.svelte";
  import { scope, holonId, activeTab } from "$lib/stores";
  import { isCommonsHub, scopeOptionsFor } from "$lib/hubChrome";
  import { setScope, type Scope } from "$lib/config";
  import { currentUser } from "$lib/auth";
  import { t } from "$lib/i18n";

  /** Force the small cycling toggle (see PillSwitch). */
  export let compact = false;
  /** Force the full segmented control (see PillSwitch). */
  export let expanded = false;

  // "Mine" needs someone to be personal about — hidden logged out, EXCEPT
  // when a persisted personal scope is active, so the pill still shows what's
  // selected (the views render their own log-in prompts).
  $: options = scopeOptionsFor($holonId, [
    ...($currentUser || $scope === "personal"
      ? [
          {
            id: "personal",
            label: $t("scope.personal"),
            icon: "person" as const,
          },
        ]
      : []),
    { id: "all", label: $t("scope.local"), icon: "home" as const },
    { id: "networked", label: $t("scope.global"), icon: "globe" as const },
  ]);
  // No visible "SHOW" title on the Commons Hub calendar tab (aria-label stays).
  $: title =
    isCommonsHub($holonId) && $activeTab === "calendar" ? "" : $t("scope.show");

  function onChange(id: string) {
    scope.set(id as Scope);
    setScope(id as Scope);
  }
</script>

<PillSwitch
  {options}
  value={$scope}
  {onChange}
  showText
  {compact}
  {expanded}
  icon="filter"
  {title}
  label={$t("scope.aria")}
/>
