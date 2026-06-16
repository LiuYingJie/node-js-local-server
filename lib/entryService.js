const { listFolders, getBreadcrumb } = require('./folderService');
const { listFilesInFolder } = require('./fileService');
const { getFileTypeLabel } = require('./downloadHelper');

async function listEntries(folderId, baseUrl) {
  const folders = await listFolders(folderId);
  const files = await listFilesInFolder(folderId);
  const breadcrumb = await getBreadcrumb(folderId ?? null);

  return {
    folderId: folderId ?? null,
    breadcrumb,
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      type: 'folder',
      createTime: f.createTime,
    })),
    files: files.map((f) => ({
      id: f.id,
      name: f.fileName,
      type: 'file',
      size: f.size,
      md5: f.md5,
      desc: f.desc,
      uploadTime: f.uploadTime,
      fileType: getFileTypeLabel(f.fileName),
      relativePath: f.relativePath,
      downloadUrl: `${baseUrl}/download/${encodeURI(f.relativePath || f.fileName)}`,
    })),
  };
}

module.exports = { listEntries };
