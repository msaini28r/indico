/* This file is part of Indico.
 * Copyright (C) 2002 - 2018 European Organization for Nuclear Research (CERN).
 *
 * Indico is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License as
 * published by the Free Software Foundation; either version 3 of the
 * License, or (at your option) any later version.
 *
 * Indico is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Indico; if not, see <http://www.gnu.org/licenses/>.
 */

import moment from 'moment';
import {combineReducers} from 'redux';

import camelizeKeys from 'indico/utils/camelize';
import {serializeDate} from 'indico/utils/date';
import {requestReducer} from 'indico/utils/redux';
import {actions as bookRoomActions} from '../../modules/bookRoom';
import * as actions from '../../actions';
import * as calendarActions from './actions';
import {actions as bookingActions} from '../../common/bookings';
import {filterReducerFactory} from '../../common/filters';
import {initialRoomFilterStateFactory, processRoomFilters} from '../../common/roomSearch/reducers';
import {initialDatePickerState} from '../../common/timeline/reducers';


const datePickerState = () => ({...initialDatePickerState, selectedDate: serializeDate(moment())});

const datePickerReducer = (state = datePickerState(), action) => {
    switch (action.type) {
        case calendarActions.SET_DATE:
            return {
                ...state,
                dateRange: [],
                selectedDate: action.date
            };
        case calendarActions.SET_MODE:
            return {
                ...state,
                mode: action.mode
            };
        case actions.RESET_PAGE_STATE:
            return datePickerState();
    }
    return state;
};

export const initialDataState = {
    rows: [],
    roomIds: null,
};

const initialActiveBookingsState = {
    rowsLeft: 0,
    data: {},
};

export const initialState = () => ({
    filters: initialRoomFilterStateFactory('calendar'),
    data: initialDataState,
    datePicker: datePickerState(),
    activeBookings: initialActiveBookingsState,
    view: 'timeline',
});

function filterDeletedBooking(calendar, bookingId, roomId) {
    return calendar.map((row) => {
        if (row.roomId !== roomId) {
            return row;
        }

        const newRow = {...row};
        for (const type of Object.keys(row)) {
            const bookingData = row[type];
            if (!Object.keys(bookingData).length) {
                continue;
            }

            for (const dt of Object.keys(bookingData)) {
                const dayBookingData = bookingData[dt];
                newRow[type][dt] = dayBookingData.filter((data) => {
                    return data.reservation.id !== bookingId;
                });
            }
        }

        return newRow;
    });
}

function acceptPrebooking(calendar, bookingId, roomId) {
    return calendar.map((row) => {
        if (row.roomId !== roomId) {
            return row;
        }

        const newRow = {...row};
        const preBookings = row['preBookings'];
        for (const dt of Object.keys(preBookings)) {
            const preBookingsData = preBookings[dt];
            const preBooking = preBookingsData.find((item) => {
                return item.reservation.id === bookingId;
            });

            if (!(dt in newRow['bookings'])) {
                newRow['bookings'][dt] = [];
            }

            newRow['bookings'][dt] = [...newRow['bookings'][dt], preBooking];
            newRow['preBookings'][dt] = preBookingsData.filter((item) => {
                return item.reservation.id !== bookingId;
            });
        }

        return newRow;
    });
}

export default combineReducers({
    requests: combineReducers({
        calendar: requestReducer(
            calendarActions.FETCH_CALENDAR_REQUEST,
            calendarActions.FETCH_CALENDAR_SUCCESS,
            calendarActions.FETCH_CALENDAR_ERROR
        ),
        activeBookings: requestReducer(
            calendarActions.FETCH_ACTIVE_BOOKINGS_REQUEST,
            calendarActions.FETCH_ACTIVE_BOOKINGS_SUCCESS,
            calendarActions.FETCH_ACTIVE_BOOKINGS_ERROR,
        )
    }),
    filters: filterReducerFactory('calendar', initialRoomFilterStateFactory, processRoomFilters),
    activeBookings: (state = initialActiveBookingsState, action) => {
        switch (action.type) {
            case calendarActions.ACTIVE_BOOKINGS_RECEIVED: {
                const {bookings: newBookings, rowsLeft} = camelizeKeys(action.data);
                const {data} = state;
                const newData = {...data};

                Object.entries(newBookings).forEach(([date, bookings]) => {
                    if (!(date in newData)) {
                        newData[date] = bookings;
                    } else {
                        newData[date] = [...newData[date], ...bookings];
                    }
                });

                return {...state, data: newData, rowsLeft};
            }
            case calendarActions.CLEAR_ACTIVE_BOOKINGS:
                return {...state, data: {}, rowsLeft: 0};
            case bookingActions.DELETE_BOOKING_SUCCESS: {
                const {bookingId} = camelizeKeys(action.data);
                const {data} = state;
                const newData = {};

                Object.entries(data).forEach(([day, bookings]) => {
                    const newBookings = bookings.filter(({reservation: {id}}) => id !== bookingId);
                    if (newBookings.length) {
                        newData[day] = newBookings;
                    }
                });

                return {...state, data: newData};
            }
            case bookingActions.BOOKING_STATE_UPDATED: {
                const {booking: {id: bookingId, state: bookingState}} = camelizeKeys(action.data);
                const {data} = state;
                const newData = {};

                if (bookingState === 'rejected' || bookingState === 'cancelled') {
                    Object.entries(data).forEach(([day, bookings]) => {
                        const newBookings = bookings.filter(({reservation: {id}}) => id !== bookingId);
                        if (newBookings.length) {
                            newData[day] = bookings.filter(({reservation: {id}}) => id !== bookingId);
                        }
                    });
                } else {
                    Object.entries(data).forEach(([day, bookings]) => {
                        newData[day] = bookings.map((booking) => {
                            const {reservation} = booking;
                            const reservationId = reservation.id;
                            const newReservation = {...reservation};

                            if (reservationId === bookingId) {
                                newReservation.isAccepted = true;
                            }

                            return {...booking, reservation: newReservation};
                        });
                    });
                }

                return {...state, data: newData};
            }
            default:
                return state;
        }
    },
    data: (state = initialDataState, action) => {
        switch (action.type) {
            case calendarActions.FETCH_CALENDAR_REQUEST:
                return {...state, rows: []};
            case calendarActions.ROWS_RECEIVED:
                return {...state, rows: camelizeKeys(action.data)};
            case calendarActions.ROOM_IDS_RECEIVED:
                return {...state, roomIds: action.data.slice()};
            case bookingActions.DELETE_BOOKING_SUCCESS: {
                const {bookingId, roomId} = camelizeKeys(action.data);
                const {rows} = state;
                return {...state, rows: filterDeletedBooking(rows, bookingId, roomId)};
            }
            case bookingActions.BOOKING_STATE_UPDATED: {
                const {booking: {id, roomId, state: bookingState}} = camelizeKeys(action.data);
                const {rows} = state;
                let newRows;

                if (bookingState === 'rejected' || bookingState === 'cancelled') {
                    newRows = filterDeletedBooking(rows, id, roomId);
                } else if (bookingState === 'accepted') {
                    newRows = acceptPrebooking(rows, id, roomId);
                }

                return {...state, rows: newRows};
            }
            case bookRoomActions.CREATE_BOOKING_SUCCESS: {
                const bookingData = camelizeKeys(action.data);
                const {roomId, calendarData} = bookingData;
                const {rows} = state;
                const newRows = rows.map((row) => {
                    if (row.roomId !== roomId) {
                        return row;
                    }

                    const newRow = {...row};
                    for (const type of ['bookings', 'preBookings']) {
                        if (!(type in calendarData)) {
                            continue;
                        }

                        const values = calendarData[type];
                        for (const dt of Object.keys(values)) {
                            const previousValues = newRow[type][dt] || [];
                            newRow[type][dt] = [...previousValues, ...values[dt]];
                        }
                    }
                    return newRow;
                });

                return {...state, rows: newRows};
            }
            case bookingActions.UPDATED_BOOKING_RECEIVED: {
                const {roomCalendar} = camelizeKeys(action.data);
                const {rows} = state;
                const newRows = rows.map((row) => {
                    if (row.roomId === roomCalendar[0].roomId) {
                        return roomCalendar[0];
                    }

                    return row;
                });

                return {...state, rows: newRows};
            }
            default:
                return state;
        }
    },
    datePicker: datePickerReducer,
    view: (state = 'timeline', action) => {
        switch (action.type) {
            case calendarActions.CHANGE_VIEW:
                return action.view;
            case actions.RESET_PAGE_STATE:
                return 'timeline';
            default:
                return state;
        }
    }
});
