import * as api from './sharedKnowledgeApi'

export const listCourses = (...args: Parameters<typeof api.listCourses>) => api.listCourses(...args)
export const getCourse = (...args: Parameters<typeof api.getCourse>) => api.getCourse(...args)
export const createCourse = (...args: Parameters<typeof api.createCourse>) => api.createCourse(...args)
export const updateCourse = (...args: Parameters<typeof api.updateCourse>) => api.updateCourse(...args)
export const deleteCourse = (...args: Parameters<typeof api.deleteCourse>) => api.deleteCourse(...args)
export const uploadCourseDocument = (...args: Parameters<typeof api.uploadCourseDocument>) => api.uploadCourseDocument(...args)
export const detachCourseDocument = (...args: Parameters<typeof api.detachCourseDocument>) => api.detachCourseDocument(...args)
export const readCourseDocument = (...args: Parameters<typeof api.readCourseDocument>) => api.readCourseDocument(...args)

export const retryCourseDocument = (...args: Parameters<typeof api.retryCourseDocument>) => api.retryCourseDocument(...args)


export const readKnowledgeStorage = (...args: Parameters<typeof api.readKnowledgeStorage>) => api.readKnowledgeStorage(...args)
export const saveDocumentKnowledge = (...args: Parameters<typeof api.saveDocumentKnowledge>) => api.saveDocumentKnowledge(...args)
