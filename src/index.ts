import { dataDir, definePlugin } from "@toolbelt/sdk";
import { ontrack } from "./plugin";
import { load, save } from "./store";

definePlugin(ontrack({ load: () => load(dataDir()), save: (data) => save(dataDir(), data) }));
