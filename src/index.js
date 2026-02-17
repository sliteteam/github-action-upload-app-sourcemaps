const path = require("path");
const fs = require("fs").promises;
const glob = require("@actions/glob");
const core = require("@actions/core");
const io = require("@actions/io");
const exec = require("@actions/exec");

const ROOT_TMP_DIR_PATH = "/tmp";
const TMP_DIR_PATH = path.join(ROOT_TMP_DIR_PATH, "upload-app-sourcemap-files");

async function run() {
  const imageTag = core.getInput("imageTag", { required: true });
  const assetsPublicPath = core.getInput("assetsPublicPath", {
    required: true,
  });
  const bugsnagApiKey = core.getInput("bugsnagApiKey", { required: true });

  try {
    await io.rmRF(TMP_DIR_PATH);
  } catch (e) {
    console.log("Failed to remove tmp dir, no big deal, moving forward");
  }
  await io.mkdirP(TMP_DIR_PATH);

  try {
    await exec.exec(
      `docker run --rm -u root -v ${ROOT_TMP_DIR_PATH}:${ROOT_TMP_DIR_PATH} ${imageTag} sh -c "cp -R /slite/app/public ${TMP_DIR_PATH} && cp -R /slite/app/sourcemaps ${TMP_DIR_PATH} && cp /slite/app/version.json ${TMP_DIR_PATH}"`
    );
  } catch (error) {
    console.error("Error while extracting files from image");
    console.error(error);
    throw error;
  }

  let appVersion;
  try {
    const appVersionFile = await fs.readFile(
      path.join(TMP_DIR_PATH, "version.json")
    );
    const versionFile = JSON.parse(appVersionFile.toString());
    appVersion = versionFile.version;
    if (!appVersion) {
      console.log("App version file content", appVersionFile.toString());
      throw new Error("Empty app version");
    }
    console.log("App version found", appVersion);
  } catch (error) {
    console.error("Error while reading app version");
    console.error(error);
    throw error;
  }

  try {
    const globber = await glob.create(`${TMP_DIR_PATH}/sourcemaps/*.map`);
    for await (const sourceMap of globber.globGenerator()) {
      const minifiedFile = sourceMap
        .slice(0, -4)
        .replace("sourcemaps/", "public/");

      const minifiedFilename = path.basename(minifiedFile);

      const command = `curl https://upload.bugsnag.com/ -F apiKey=${bugsnagApiKey} -F minifiedUrl=${assetsPublicPath}${minifiedFilename} -F sourceMap=@${path.join(
        sourceMap
      )} -F overwrite=true -F minifiedFile=@${path.join(
        minifiedFile
      )} -F appVersion=${appVersion}`;

      await exec.exec(command);
    }
  } catch (e) {
    console.error("Error while uploading sourcemaps to BugSnag");
    console.error(e);
    throw e;
  }
}

run().catch(function handleError(error) {
  console.error(error);
  process.exit(1);
});
